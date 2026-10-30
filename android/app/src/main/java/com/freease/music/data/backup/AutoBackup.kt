package com.freease.music.data.backup

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.freease.music.FreeaseApp
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Cadangan otomatis mingguan ke folder pilihan pengguna (mis. Download). Folder di luar aplikasi
 * tidak ikut terhapus saat Freease dicopot, jadi koleksi & riwayat bisa dipulihkan setelah pasang ulang.
 * Menyimpan [KEEP] cadangan terakhir.
 */
object AutoBackup {
    private const val WORK = "auto_backup"
    private const val WORK_NOW = "auto_backup_now"
    const val PREFIX = "freease-cadangan-otomatis-"
    const val KEEP = 4

    fun schedule(context: Context, enabled: Boolean) {
        val wm = runCatching { WorkManager.getInstance(context) }.getOrNull() ?: return
        if (!enabled) {
            wm.cancelUniqueWork(WORK)
            return
        }
        val req = PeriodicWorkRequestBuilder<AutoBackupWorker>(7, TimeUnit.DAYS)
            .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
            .build()
        wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun runNow(context: Context) {
        runCatching {
            WorkManager.getInstance(context).enqueueUniqueWork(WORK_NOW, ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<AutoBackupWorker>().build())
        }
    }

    /** Simpan izin akses folder secara permanen (bertahan setelah HP dinyalakan ulang). */
    fun persist(context: Context, tree: Uri) {
        context.contentResolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    }

    fun release(context: Context, tree: Uri) {
        runCatching { context.contentResolver.releasePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
    }

    /** Nama folder untuk ditampilkan ("Download", "Documents/Freease", …). */
    fun folderLabel(tree: Uri): String =
        runCatching { DocumentsContract.getTreeDocumentId(tree).substringAfter(':').ifBlank { "Penyimpanan utama" } }.getOrDefault("folder pilihan")

    /** Tulis satu cadangan ke folder [tree] lalu buang cadangan otomatis lama. */
    suspend fun write(context: Context, tree: Uri, json: String, now: Long = System.currentTimeMillis()) {
        val cr = context.contentResolver
        val dir = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val name = PREFIX + SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date(now)) + ".json"
        val doc = DocumentsContract.createDocument(cr, dir, "application/json", name) ?: throw IOException("Folder cadangan tidak bisa ditulis")
        cr.openOutputStream(doc, "wt")?.use { it.write(json.toByteArray(Charsets.UTF_8)) } ?: throw IOException("Folder cadangan tidak bisa ditulis")
        // Simpan KEEP terbaru saja.
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val ours = ArrayList<Pair<String, String>>() // (nama, id dokumen)
        cr.query(children, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val n = c.getString(0) ?: continue
                if (n.startsWith(PREFIX) && n.endsWith(".json")) ours += n to c.getString(1)
            }
        }
        oldOnes(ours.map { it.first }).forEach { stale ->
            val id = ours.first { it.first == stale }.second
            runCatching { DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, id)) }
        }
    }

    /** Nama berkas yang harus dihapus (selain [KEEP] terbaru; nama berisi tanggal sehingga urut abjad = urut waktu). */
    fun oldOnes(names: List<String>): List<String> = names.sortedDescending().drop(KEEP)
}

class AutoBackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as FreeaseApp).container
        val folder = c.settings.current.autoBackupFolder.ifBlank { return Result.success() }
        return try {
            val json = Backup.toJson(c.library.exportBackup())
            AutoBackup.write(applicationContext, Uri.parse(folder), json)
            c.settings.setLastAutoBackup(System.currentTimeMillis())
            Result.success()
        } catch (e: SecurityException) {
            // Izin folder dicabut / folder dihapus: matikan, pengguna perlu memilih ulang.
            c.settings.setAutoBackupFolder("")
            Result.failure()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}

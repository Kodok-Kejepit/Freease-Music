package com.freease.music.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.freease.music.MainActivity
import com.freease.music.R

/** Widget lirik: baris yang sedang dinyanyikan + baris berikutnya. Diperbarui oleh service saat baris berganti. */
class LyricsWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        render(context, manager, ids, p.getString("song", null), p.getString("line", null), p.getString("next", null))
    }

    companion object {
        private const val PREFS = "widget_lyrics"

        private fun ids(context: Context): IntArray =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, LyricsWidget::class.java))

        fun hasWidgets(context: Context): Boolean = runCatching { ids(context).isNotEmpty() }.getOrDefault(false)

        fun push(context: Context, song: String?, line: String?, next: String?) {
            val ids = ids(context)
            if (ids.isEmpty()) return
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("song", song).putString("line", line).putString("next", next).apply()
            render(context, AppWidgetManager.getInstance(context), ids, song, line, next)
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray, song: String?, line: String?, next: String?) {
            val v = RemoteViews(context.packageName, R.layout.widget_lyrics)
            v.setTextViewText(R.id.wl_song, song ?: context.getString(R.string.widget_lyrics_idle))
            v.setTextViewText(R.id.wl_line, line ?: "• • •")
            v.setTextViewText(R.id.wl_next, next.orEmpty())
            val open = PendingIntent.getActivity(
                context, 0x57,
                Intent(context, MainActivity::class.java)
                    .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(MainActivity.EXTRA_OPEN_LYRICS, true),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            v.setOnClickPendingIntent(R.id.wl_root, open)
            manager.updateAppWidget(ids, v)
        }
    }
}

/**
 * Widget "Lanjutkan": empat pintasan — antrean terakhir, Lagu yang Disukai, Daily Mix pertama,
 * dan playlist teratas. Ketuk = buka Freease dan langsung putar.
 */
class ContinueWidget : AppWidgetProvider() {
    data class Tile(val label: String, val source: String)

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        render(context, manager, ids, load(context))
    }

    companion object {
        private const val PREFS = "widget_continue"
        const val SOURCE_RESUME = "resume"

        private fun ids(context: Context): IntArray =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, ContinueWidget::class.java))

        fun hasWidgets(context: Context): Boolean = runCatching { ids(context).isNotEmpty() }.getOrDefault(false)

        private fun load(context: Context): List<Tile> {
            val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return (0 until 4).mapNotNull { i ->
                val label = p.getString("l$i", null) ?: return@mapNotNull null
                Tile(label, p.getString("s$i", "") ?: "")
            }.ifEmpty { defaults() }
        }

        private fun defaults() = listOf(
            Tile("Lanjutkan", SOURCE_RESUME),
            Tile("Lagu yang Disukai", "liked"),
            Tile("Baru diputar", "recent"),
            Tile("Unduhan", "downloads"),
        )

        fun push(context: Context, tiles: List<Tile>) {
            val ids = ids(context)
            if (ids.isEmpty()) return
            val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            tiles.take(4).forEachIndexed { i, t -> e.putString("l$i", t.label).putString("s$i", t.source) }
            e.apply()
            render(context, AppWidgetManager.getInstance(context), ids, tiles)
        }

        private fun iconFor(source: String) = when {
            source == SOURCE_RESUME -> R.drawable.ic_w_play
            source == "liked" -> R.drawable.ic_w_heart
            source == "downloads" -> R.drawable.ic_w_download
            source == "recent" || source.startsWith("mix") -> R.drawable.ic_w_sparkle
            else -> R.drawable.ic_w_queue
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray, tiles: List<Tile>) {
            val v = RemoteViews(context.packageName, R.layout.widget_continue)
            val views = intArrayOf(R.id.wc_1, R.id.wc_2, R.id.wc_3, R.id.wc_4)
            val texts = intArrayOf(R.id.wc_1_text, R.id.wc_2_text, R.id.wc_3_text, R.id.wc_4_text)
            val icons = intArrayOf(R.id.wc_1_icon, R.id.wc_2_icon, R.id.wc_3_icon, R.id.wc_4_icon)
            val all = (tiles + defaults()).distinctBy { it.source }.take(4)
            all.forEachIndexed { i, t ->
                // Label lama (sebelum 2.0) masih bisa berawalan simbol; dibersihkan supaya hanya ikon vektor yang tampil.
                v.setTextViewText(texts[i], t.label.replace(Regex("^[^\\p{L}\\p{N}]+"), ""))
                v.setImageViewResource(icons[i], iconFor(t.source))
                val intent = Intent(context, MainActivity::class.java)
                    .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(MainActivity.EXTRA_PLAY_SOURCE, t.source)
                v.setOnClickPendingIntent(
                    views[i],
                    PendingIntent.getActivity(context, 0x60 + i, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
                )
            }
            manager.updateAppWidget(ids, v)
        }
    }
}

/** Widget "Freease Smart": tombol asisten, karaoke tersimpan, dan kenali lagu. */
class SmartWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val v = RemoteViews(context.packageName, R.layout.widget_smart)
        v.setTextViewText(R.id.ws_mic_text, context.getString(R.string.widget_smart_mic))
        v.setTextViewText(R.id.ws_karaoke_text, context.getString(R.string.widget_smart_karaoke))
        v.setTextViewText(R.id.ws_recognize_text, context.getString(R.string.widget_smart_recognize))
        v.setImageViewResource(R.id.ws_mic_icon, R.drawable.ic_w_mic)
        v.setImageViewResource(R.id.ws_karaoke_icon, R.drawable.ic_w_karaoke)
        v.setImageViewResource(R.id.ws_recognize_icon, R.drawable.ic_w_search)
        fun open(code: Int, build: Intent.() -> Unit) = PendingIntent.getActivity(
            context, code,
            Intent(context, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK).apply(build),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        v.setOnClickPendingIntent(R.id.ws_mic, open(0x70) { action = MainActivity.ACTION_ASSISTANT })
        v.setOnClickPendingIntent(R.id.ws_karaoke, open(0x71) { putExtra(MainActivity.EXTRA_OPEN_ROUTE, com.freease.music.ui.navigation.Routes.KARAOKE_SAVED) })
        v.setOnClickPendingIntent(R.id.ws_recognize, open(0x72) { action = MainActivity.ACTION_RECOGNIZE })
        manager.updateAppWidget(ids, v)
    }
}

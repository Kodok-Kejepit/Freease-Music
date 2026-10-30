package com.freease.music

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Penjaga: teks yang tampil di aplikasi/widget tidak boleh memakai emoji atau simbol pengganti ikon
 * (🎤 ▶ ♥ ⬇ ✦ ✓ …) — pakai ikon vektor. Komentar kode diabaikan. "→" (petunjuk menu), "─" (pemisah
 * laporan crash), dan "♪" (penanda baris instrumental di data lirik, tidak ditampilkan) diizinkan.
 */
class NoEmojiTest {
    private val pattern = Regex(
        "[\\u2190-\\u21FF\\u2300-\\u23FF\\u2460-\\u27BF\\u2900-\\u297F\\u2B00-\\u2BFF\\u3030\\u303D\\u3297\\u3299\\uFE0F]|[\\uD83C-\\uD83E][\\uDC00-\\uDFFF]",
    )
    private val allowed = setOf("→", "─", "♪")

    @Test
    fun noEmojiInAppText() {
        val root = File("src/main")
        val bad = root.walkTopDown().filter { it.isFile && (it.extension == "kt" || it.extension == "xml") }.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, line ->
                val t = line.trim()
                if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("<!--")) return@mapIndexedNotNull null
                val found = pattern.findAll(line).map { it.value }.filter { it !in allowed }.toList()
                if (found.isEmpty()) null else "${f.relativeTo(root)}:${i + 1} ${found.joinToString("")}"
            }
        }.toList()
        assertTrue("Emoji/simbol mentah ditemukan:\n" + bad.joinToString("\n"), bad.isEmpty())
    }
}

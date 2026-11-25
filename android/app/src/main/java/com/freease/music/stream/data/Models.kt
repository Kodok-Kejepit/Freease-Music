package com.freease.music.stream.data

/** Gambar yang butuh Referer tertentu supaya CDN-nya mau melayani. */
data class Img(val url: String, val referer: String? = null)

fun img(url: String?, referer: String? = null): Img? = url?.takeIf { it.startsWith("http") }?.let { Img(it, referer) }

/** Satu judul anime/donghua dari sumber mana pun. ID berawalan sumber (`od:`, `ac:`), Animekompi tanpa awalan. */
data class Anime(
    val id: String,
    val title: String,
    val cover: Img?,
    val synopsis: String? = null,
    val type: String? = null,
    val status: String? = null,
    val year: Int? = null,
    val rating: String? = null,
    val studio: String? = null,
    val genres: List<String> = emptyList(),
    val source: String,
    /** Nomor episode terakhir (daftar rilis) dan ID episodenya bila langsung bisa diputar. */
    val episode: String? = null,
    val episodeId: String? = null,
    val note: String? = null,
)

data class EpisodeRef(val id: String, val number: String, val title: String, val date: String? = null)

data class AnimeDetail(val anime: Anime, val altTitles: String?, val episodes: List<EpisodeRef>)

/** Berkas video yang bisa langsung diputar ExoPlayer, atau pemutar situs lain (embed) sebagai cadangan. */
data class VideoSource(
    val label: String,
    val quality: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val embed: Boolean = false,
) {
    val height: Int get() = Regex("(\\d{3,4})").find(quality)?.value?.toIntOrNull() ?: 0
}

data class EpisodeData(
    val id: String,
    val number: String,
    val title: String,
    val anime: Anime?,
    val prev: EpisodeRef?,
    val next: EpisodeRef?,
    val sources: List<VideoSource>,
    val episodes: List<EpisodeRef>,
)

data class ScheduleItem(val id: String, val title: String, val cover: Img?, val episode: String, val time: String?, val source: String)
data class ScheduleDay(val day: String, val items: List<ScheduleItem>)

data class Genre(val id: String, val name: String)

data class Page<T>(val items: List<T>, val page: Int, val hasMore: Boolean)

data class Manga(
    val id: String,
    val title: String,
    val cover: Img?,
    val source: String,
    val lang: String,
    val type: String? = null,
    val latest: String? = null,
    val altTitles: List<String> = emptyList(),
)

data class Chapter(val id: String, val number: String?, val title: String?, val at: Long? = null) {
    val label: String get() = number?.let { "Chapter $it" } ?: title ?: "Bab"
}

data class MangaDetail(
    val manga: Manga,
    val description: String,
    val genres: List<String>,
    val status: String?,
    val author: String?,
    val chapters: List<Chapter>,
    val partial: Boolean = false,
)

fun cleanStatus(s: String?): String? {
    val t = s.orEmpty().lowercase()
    return when {
        Regex("ongoing|berjalan|releasing").containsMatchIn(t) -> "Ongoing"
        Regex("complete|tamat|selesai|end").containsMatchIn(t) -> "Tamat"
        "hiatus" in t -> "Hiatus"
        else -> null
    }
}

fun chapterNum(s: String?): String? = Regex("(\\d+(?:\\.\\d+)?)").find(s.orEmpty())?.value?.trimStart('0')?.ifEmpty { "0" }

/** Bab bernomor sama dari satu sumber cukup satu; urut naik menurut nomor. */
fun tidyChapters(list: List<Chapter>): List<Chapter> {
    val byNum = LinkedHashMap<Double, Chapter>()
    val odd = mutableListOf<Chapter>()
    for (c in list) {
        val n = c.number?.toDoubleOrNull()
        if (n == null) { odd += c; continue }
        val old = byNum[n]
        if (old == null || (c.at ?: 0) > (old.at ?: 0)) byNum[n] = c
    }
    return byNum.entries.sortedBy { it.key }.map { it.value } + odd
}

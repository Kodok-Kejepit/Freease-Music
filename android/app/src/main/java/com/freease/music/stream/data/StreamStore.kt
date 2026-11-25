package com.freease.music.stream.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Judul yang disimpan / sedang ditonton-dibaca. kind: "anime" atau "manga". */
data class Saved(
    val kind: String,
    val id: String,
    val title: String,
    val cover: Img?,
    val sub: String? = null,
    val itemId: String? = null,
    val itemLabel: String? = null,
    val pos: Long = 0,
    val dur: Long = 0,
    val updated: Long = System.currentTimeMillis(),
) {
    val key get() = "$kind|$id"
    val progress: Float get() = if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f
}

/** Posisi satu episode (ms) atau satu bab (halaman). */
data class Seen(val pos: Long, val dur: Long, val at: Long)

data class StreamData(
    val favs: List<Saved> = emptyList(),
    val recent: List<Saved> = emptyList(),
    val seen: Map<String, Seen> = emptyMap(),
)

/** Koleksi & progres Freease Stream, disimpan di HP (berkas JSON kecil), tidak pernah dikirim ke mana pun. */
class StreamStore(private val file: File, private val scope: CoroutineScope) {
    private val lock = Mutex()
    private val _data = MutableStateFlow(load())
    val data: StateFlow<StreamData> = _data

    fun isFav(kind: String, id: String) = _data.value.favs.any { it.kind == kind && it.id == id }
    fun progressOf(kind: String, id: String) = _data.value.recent.firstOrNull { it.kind == kind && it.id == id }
    fun seen(itemId: String) = _data.value.seen[itemId]

    fun toggleFav(item: Saved) = update { d ->
        if (d.favs.any { it.key == item.key }) d.copy(favs = d.favs.filterNot { it.key == item.key })
        else d.copy(favs = listOf(item.copy(updated = System.currentTimeMillis())) + d.favs)
    }

    /** Simpan progres: posisi episode/bab dan entri "Lanjutkan" judulnya (maks. 60 judul, 4000 item). */
    fun saveProgress(item: Saved) = update { d ->
        val now = System.currentTimeMillis()
        val seen = (d.seen + (item.itemId.orEmpty() to Seen(item.pos, item.dur, now))).entries
            .sortedByDescending { it.value.at }.take(4000).associate { it.key to it.value }
        d.copy(recent = (listOf(item.copy(updated = now)) + d.recent.filterNot { it.key == item.key }).take(60), seen = seen)
    }

    fun forget(kind: String, id: String) = update { d -> d.copy(recent = d.recent.filterNot { it.kind == kind && it.id == id }) }

    private fun update(f: (StreamData) -> StreamData) {
        scope.launch(Dispatchers.IO) {
            lock.withLock {
                val next = f(_data.value)
                _data.value = next
                runCatching {
                    val tmp = File(file.parentFile, file.name + ".tmp")
                    tmp.writeText(encode(next).toString())
                    tmp.renameTo(file)
                }
            }
        }
    }

    private fun load(): StreamData = runCatching { decode(JSONObject(file.readText())) }.getOrDefault(StreamData())

    companion object {
        private fun Saved.json() = JSONObject().apply {
            put("kind", kind); put("id", id); put("title", title); put("cover", cover?.url); put("ref", cover?.referer); put("sub", sub)
            put("itemId", itemId); put("itemLabel", itemLabel); put("pos", pos); put("dur", dur); put("updated", updated)
        }
        private fun JSONObject.saved() = Saved(optString("kind"), optString("id"), optString("title"), img(str("cover"), str("ref")), str("sub"),
            str("itemId"), str("itemLabel"), optLong("pos"), optLong("dur"), optLong("updated"))

        fun encode(d: StreamData) = JSONObject().apply {
            put("v", 1)
            put("favs", JSONArray().apply { d.favs.forEach { put(it.json()) } })
            put("recent", JSONArray().apply { d.recent.forEach { put(it.json()) } })
            put("seen", JSONObject().apply { d.seen.forEach { (k, s) -> put(k, JSONArray(listOf(s.pos, s.dur, s.at))) } })
        }

        fun decode(j: JSONObject): StreamData {
            val seen = j.optJSONObject("seen")
            return StreamData(
                favs = j.optJSONArray("favs").objects().map { it.saved() }.filter { it.id.isNotEmpty() },
                recent = j.optJSONArray("recent").objects().map { it.saved() }.filter { it.id.isNotEmpty() },
                seen = seen?.keys()?.asSequence()?.associateWith { k -> seen.optJSONArray(k).let { a -> Seen(a.optLong(0), a.optLong(1), a.optLong(2)) } }.orEmpty(),
            )
        }
    }
}

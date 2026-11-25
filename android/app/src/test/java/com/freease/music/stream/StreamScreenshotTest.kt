package com.freease.music.stream

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.media3.common.util.UnstableApi
import androidx.test.core.app.ApplicationProvider
import com.freease.music.FreeaseApp
import com.freease.music.stream.ui.StreamRoutes
import com.freease.music.ui.FreeaseRoot
import com.freease.music.ui.navigation.AppActions
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Render layar Freease Stream dengan data sungguhan (perlu internet): `-PstreamLive`. Gambar di build/shots-stream. */
@UnstableApi
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h860dp-xxhdpi")
class StreamScreenshotTest {
    @get:Rule
    val compose = createComposeRule()
    private val out = "build/shots-stream"

    private fun settle(ms: Long) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            compose.mainClock.advanceTimeBy(250)
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            Thread.sleep(100)
        }
        compose.waitForIdle()
    }

    @Test
    fun screens() {
        assumeTrue(System.getProperty("stream.live") == "true")
        val c = ApplicationProvider.getApplicationContext<FreeaseApp>().container
        var actions: AppActions? = null
        compose.setContent { FreeaseRoot(c) { actions = it } }
        settle(3_000)
        fun shot(name: String, route: String, wait: Long) {
            compose.runOnUiThread { actions!!.navigate(route) }
            settle(wait)
            // Lembar izin muncul otomatis saat pertama dibuka; tutup seperti menekan "Nanti saja".
            compose.runOnUiThread { actions!!.permissions = null }
            settle(600)
            compose.onRoot().captureRoboImage("$out/$name.png")
        }
        shot("01_stream_anime", StreamRoutes.home("anime"), 12_000)
        shot("02_stream_komik", StreamRoutes.home("komik"), 15_000)
        shot("03_browse_anime", StreamRoutes.browse(), 8_000)
        shot("04_browse_komik", StreamRoutes.mangaBrowse("ki"), 8_000)
        val (animeId, epId, mangaId, chapterId) = runBlocking {
            val h = c.stream.animeHome()
            val a = h.ak.trending.first().id
            val ep = c.stream.detail(a).episodes.first().id
            val m = c.stream.browseManga("km", "popular", 1, null).first().id
            val ch = c.stream.mangaDetail(m).chapters.last().id
            listOf(a, ep, m, ch)
        }
        shot("05_anime_detail", StreamRoutes.anime(animeId), 8_000)
        shot("06_watch", StreamRoutes.watch(epId), 12_000)
        shot("07_manga_detail", StreamRoutes.manga(mangaId), 8_000)
        shot("08_reader", StreamRoutes.read(mangaId, chapterId), 10_000)
        shot("09_schedule", StreamRoutes.schedule(), 8_000)
        shot("10_library", StreamRoutes.LIBRARY, 2_000)
        shot("11_search", StreamRoutes.SEARCH, 2_000)
    }
}

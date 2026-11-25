package com.freease.music.stream.ui

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument

private fun str(name: String) = navArgument(name) { type = NavType.StringType; defaultValue = "" }

/** Rute-rute Freease Stream di dalam NavHost aplikasi. */
fun NavGraphBuilder.streamGraph() {
    composable(StreamRoutes.HOME, arguments = listOf(str("tab"))) { StreamHomeScreen(it.arguments?.getString("tab").orEmpty()) }
    composable(StreamRoutes.BROWSE, arguments = listOf(str("src"), str("order"), str("status"), str("genre"))) { e ->
        val a = e.arguments
        AnimeBrowseScreen(a?.getString("src").orEmpty(), a?.getString("order").orEmpty(), a?.getString("status").orEmpty(), a?.getString("genre").orEmpty())
    }
    composable(StreamRoutes.ANIME, arguments = listOf(str("id"), str("ep"), navArgument("play") { type = NavType.BoolType; defaultValue = false })) { e ->
        AnimeDetailScreen(e.arguments?.getString("id").orEmpty(), e.arguments?.getString("ep").orEmpty(), e.arguments?.getBoolean("play") == true)
    }
    composable(StreamRoutes.WATCH, arguments = listOf(str("id"))) { WatchScreen(it.arguments?.getString("id").orEmpty()) }
    composable(StreamRoutes.SCHEDULE, arguments = listOf(navArgument("dh") { type = NavType.BoolType; defaultValue = false })) { ScheduleScreen(it.arguments?.getBoolean("dh") == true) }
    composable(StreamRoutes.SEARCH) { StreamSearchScreen() }
    composable(StreamRoutes.LIBRARY) { StreamLibraryScreen() }
    composable(StreamRoutes.MANGA_BROWSE, arguments = listOf(str("src"))) { MangaBrowseScreen(it.arguments?.getString("src").orEmpty()) }
    composable(StreamRoutes.MANGA, arguments = listOf(str("id"))) { MangaDetailScreen(it.arguments?.getString("id").orEmpty()) }
    composable(StreamRoutes.READ, arguments = listOf(str("mid"), str("cid"))) { e -> ReaderScreen(e.arguments?.getString("mid").orEmpty(), e.arguments?.getString("cid").orEmpty()) }
}

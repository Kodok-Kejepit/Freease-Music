package com.freease.music

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.view.View
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import com.freease.music.widget.ContinueWidget
import com.freease.music.widget.SmartWidget
import org.junit.Assume
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Render widget ke PNG (-PshotsDir=…) untuk diperiksa mata. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h800dp-xxhdpi")
class WidgetRenderTest {
    @Test
    fun renderWidgets() {
        val dir = System.getProperty("shots.dir")
        Assume.assumeTrue(dir != null)
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        val mgr = AppWidgetManager.getInstance(ctx)
        val sm = Shadows.shadowOf(mgr)
        for ((name, cls, w, h) in listOf(
            Quad("smart", SmartWidget::class.java, 380, 200),
            Quad("continue", ContinueWidget::class.java, 380, 330),
        )) {
            val id = sm.createWidget(cls, if (name == "smart") R.layout.widget_smart else R.layout.widget_continue)
            val view = sm.getViewFor(id)
            val d = ctx.resources.displayMetrics.density
            val frame = FrameLayout(ctx).apply { setBackgroundColor(0xFF000000.toInt()); addView(view, FrameLayout.LayoutParams((w * d).toInt(), (h * d).toInt())) }
            frame.measure(View.MeasureSpec.makeMeasureSpec((w * d).toInt(), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec((h * d).toInt(), View.MeasureSpec.EXACTLY))
            frame.layout(0, 0, frame.measuredWidth, frame.measuredHeight)
            val bmp = android.graphics.Bitmap.createBitmap(frame.measuredWidth, frame.measuredHeight, android.graphics.Bitmap.Config.ARGB_8888)
            frame.draw(android.graphics.Canvas(bmp))
            java.io.File(dir, "widget_$name.png").outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        }
        ComponentName(ctx, SmartWidget::class.java) // memastikan kelas terdaftar
    }

    private data class Quad(val a: String, val b: Class<out android.appwidget.AppWidgetProvider>, val c: Int, val d: Int)
}

# NewPipeExtractor memakai refleksi (Rhino JS engine untuk decipher, nanojson).
-keep class org.schabi.newpipe.extractor.** { *; }
-keep class org.mozilla.javascript.** { *; }
-keep class org.mozilla.classfile.** { *; }
-keep class com.grack.nanojson.** { *; }
-dontwarn org.mozilla.javascript.**
-dontwarn javax.script.**
-dontwarn jdk.dynalink.**
-dontwarn java.beans.**
-dontwarn org.jsoup.**
-dontwarn com.google.re2j.**
-dontwarn javax.annotation.**

# Room entities/DAO aman secara default; jaga nama kolom untuk migrasi.
-keep class com.freease.music.data.db.** { *; }

# --- Pengecilan ukuran ---
-repackageclasses ''
-allowaccessmodification
-optimizationpasses 5
-dontwarn kotlinx.coroutines.debug.**
# Buang log debug di rilis.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
}

# ONNX Runtime (Mode Karaoke AI): kelas Java dipanggil dari kode native lewat JNI.
-keep class ai.onnxruntime.** { *; }

# Vosk ("Oke Freease"): dipanggil lewat JNA dari kode native.
-keep class org.vosk.** { *; }
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-dontwarn java.awt.**

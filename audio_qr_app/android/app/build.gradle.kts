import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val localProperties = Properties().apply {
    val propertiesFile = rootProject.file("local.properties")
    if (propertiesFile.exists()) {
        propertiesFile.inputStream().use { load(it) }
    }
}

fun buildConfigString(value: String): String = "\"${value.replace("\"", "\\\"")}\""

fun Properties.readProperty(key: String): String = getProperty(key) ?: ""

android {
    namespace = "com.example.audio_qr_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.example.audio_qr_app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        buildConfigField("String", "COS_SECRET_ID", buildConfigString(localProperties.readProperty("cosSecretId")))
        buildConfigField("String", "COS_SECRET_KEY", buildConfigString(localProperties.readProperty("cosSecretKey")))
        buildConfigField("String", "COS_REGION", buildConfigString(localProperties.readProperty("cosRegion")))
        buildConfigField("String", "COS_BUCKET", buildConfigString(localProperties.readProperty("cosBucket")))
        buildConfigField("String", "COS_SCHEME", buildConfigString(localProperties.readProperty("cosScheme").ifEmpty { "https" }))
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("libs")
            assets.srcDirs("assets")
        }
    }
}
dependencies {
    // ZXing二维码库
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    
    // HTTP客户端库用于腾讯云COS API调用
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okio:okio:3.6.0")
    
    // JSON处理库
    implementation("com.google.code.gson:gson:2.10.1")
    
    // Kotlin标准库
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.10")
}
flutter {
    source = "../.."
}

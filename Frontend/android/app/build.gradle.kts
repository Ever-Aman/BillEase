import java.util.Properties

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val signingProperties = Properties()
val signingFile = rootProject.file("key.properties")
if (signingFile.exists()) signingFile.inputStream().use { signingProperties.load(it) }
val productionRelease = gradle.startParameter.taskNames.any { it.contains("ProductionRelease", ignoreCase = true) }
if (productionRelease && !signingFile.exists()) {
    throw GradleException("Production release requires android/key.properties and a private release keystore")
}

android {
    namespace = "com.billease.mobile"
    buildFeatures { resValues = true }
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.billease.mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (signingFile.exists()) {
            create("productionRelease") {
                keyAlias = signingProperties.getProperty("keyAlias")
                keyPassword = signingProperties.getProperty("keyPassword")
                storeFile = rootProject.file(signingProperties.getProperty("storeFile"))
                storePassword = signingProperties.getProperty("storePassword")
            }
        }
    }
    flavorDimensions += "environment"
    productFlavors {
        create("development") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            signingConfig = signingConfigs.getByName("debug")
            resValue("string", "app_name", "BillEase Dev")
        }
        create("production") {
            dimension = "environment"
            resValue("string", "app_name", "BillEase")
            if (signingFile.exists()) signingConfig = signingConfigs.getByName("productionRelease")
        }
    }

    buildTypes {
        release {
            // Only development artifacts may use the debug key.

        }
    }
}

gradle.taskGraph.whenReady {
    if (allTasks.any { it.name.contains("ProductionRelease", ignoreCase = true) } && !signingFile.exists()) {
        throw GradleException("Production release requires its private signing configuration")
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

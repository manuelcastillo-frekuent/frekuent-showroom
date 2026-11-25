plugins {
    id("com.android.application")
}

// The web build is the whole app: the APK only hosts it. Run `pnpm build` first.
val webDist = rootDir.resolve("../dist")

// `-PshowroomUrl=https://…/?mode=s2s&ws=wss://…` points the online APK at another web.
val hostedUrl = (findProperty("showroomUrl") as String?)
    ?: "https://frekuent-showroom.vercel.app/"

android {
    namespace = "com.frekuent.showroom"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.frekuent.showroom"
        // Traulux TX86P ships Android 13; 24 leaves room for the YCKJNB totems.
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    // Two APKs with different ids so both can sit on the same totem and the operator
    // opens whichever the venue allows.
    flavorDimensions += "web"
    productFlavors {
        // Web bundled in the APK: demo mode, needs no network (fairs).
        create("offline") {
            dimension = "web"
            applicationIdSuffix = ".offline"
            versionNameSuffix = "-offline"
            resValue("string", "app_name", "Showroom Offline")
            buildConfigField("String", "START_URL", "\"https://appassets.androidplatform.net/index.html\"")
        }
        // Loads the hosted web: a redeploy reaches the totem with no reinstall.
        create("online") {
            dimension = "web"
            applicationIdSuffix = ".online"
            versionNameSuffix = "-online"
            resValue("string", "app_name", "Showroom Online")
            buildConfigField("String", "START_URL", "\"$hostedUrl\"")
        }
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    sourceSets {
        getByName("offline") {
            assets.srcDir(webDist)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.matching { it.name.matches(Regex("preOffline\\w*Build")) }.configureEach {
    doFirst {
        check(webDist.resolve("index.html").exists()) {
            "No web build in $webDist. Run `pnpm build` in the showroom repo first."
        }
    }
}

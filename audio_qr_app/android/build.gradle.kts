import com.android.build.gradle.LibraryExtension

allprojects {
    repositories {
        google()
        mavenCentral()
        // 添加JitPack仓库
        maven(url = "https://jitpack.io")
        // 腾讯云相关仓库
        maven(url = "https://mirrors.tencent.com/repository/maven")
        maven(url = "https://mirrors.tencent.com/nexus/repository/maven-public/")
        maven(url = "https://mirrors.tencent.com/nexus/repository/maven-thirdparty/")
        // 华为云Maven仓库
        maven(url = "https://repo.huaweicloud.com/repository/maven")
        // 阿里云Maven仓库
        maven(url = "https://maven.aliyun.com/repository/public")
        maven(url = "https://maven.aliyun.com/repository/central")
        // Gradle插件仓库
        gradlePluginPortal()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

subprojects {
    plugins.withId("com.android.library") {
        extensions.configure<LibraryExtension>("android") {
            if (namespace.isNullOrEmpty()) {
                namespace = "com.example.${project.name.replace('-', '_')}"
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}

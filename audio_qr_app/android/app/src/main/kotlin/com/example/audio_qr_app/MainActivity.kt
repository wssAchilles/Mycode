package com.example.audio_qr_app

import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {

    companion object {
        private const val TAG = "AudioQrApp"
    }

    private var nativeSDKManager: NativeSDKManager? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        
        Log.d(TAG, "配置Flutter引擎和原生SDK管理器")
        
        // 初始化原生SDK管理器
        nativeSDKManager = NativeSDKManager(this)
        nativeSDKManager?.setupChannels(flutterEngine)
        
        Log.d(TAG, "原生SDK管理器配置完成")
    }

    override fun onDestroy() {
        super.onDestroy()
        nativeSDKManager?.cleanup()
        nativeSDKManager = null
        Log.d(TAG, "Activity销毁，清理原生SDK资源")
    }
}

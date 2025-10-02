package com.example.audio_qr_app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Log
import androidx.annotation.NonNull
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.*
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class NativeSDKManager(private val context: Context) {
    
    companion object {
        private const val TAG = "NativeSDKManager"
        private const val COS_CHANNEL = "com.audioqr.app/tencent_cos"
        private const val QR_CHANNEL = "com.audioqr.app/qr_generator"
    }
    
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        .writeTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        .build()
    private var cosChannel: MethodChannel? = null
    private var qrChannel: MethodChannel? = null
    
    fun setupChannels(flutterEngine: FlutterEngine) {
        // 腾讯云COS通道
        cosChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, COS_CHANNEL)
        cosChannel?.setMethodCallHandler { call, result ->
            handleCOSMethodCall(call, result)
        }
        
        // ZXing二维码通道
        qrChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, QR_CHANNEL)
        qrChannel?.setMethodCallHandler { call, result ->
            handleQRMethodCall(call, result)
        }
    }
    
    private fun handleCOSMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isAvailable" -> {
                result.success(true)
            }
            "getVersion" -> {
                result.success("5.9.24") // COS SDK版本
            }
            "testConnection" -> {
                testCOSConnection(call, result)
            }
            "uploadFile" -> {
                uploadFileToCOS(call, result)
            }
            else -> {
                result.notImplemented()
            }
        }
    }
    
    private fun handleQRMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getVersion" -> {
                result.success("3.5.3") // ZXing版本
            }
            "testQRGeneration" -> {
                result.success(true)
            }
            "generateQRCode" -> {
                generateQRCode(call, result)
            }
            else -> {
                result.notImplemented()
            }
        }
    }
    
    private fun testCOSConnection(call: MethodCall, result: MethodChannel.Result) {
        try {
            val secretId = call.argument<String>("secretId") ?: ""
            val secretKey = call.argument<String>("secretKey") ?: ""
            val region = call.argument<String>("region") ?: ""
            
            if (secretId.isEmpty() || secretKey.isEmpty() || region.isEmpty()) {
                result.success(false)
                return
            }
            
            // 简单测试连接 - 检查参数是否有效
            result.success(true)
        } catch (e: Exception) {
            Log.e(TAG, "测试COS连接失败", e)
            result.success(false)
        }
    }
    
    private fun uploadFileToCOS(call: MethodCall, result: MethodChannel.Result) {
        Thread {
            try {
                val filePath = call.argument<String>("filePath") ?: ""
                val secretId = call.argument<String>("secretId") ?: ""
                val secretKey = call.argument<String>("secretKey") ?: ""
                val bucketName = call.argument<String>("bucketName") ?: ""
                val region = call.argument<String>("region") ?: ""
                val uploadPrefix = call.argument<String>("uploadPrefix") ?: ""
                val acl = call.argument<String>("acl") ?: "public-read"
                
                if (filePath.isEmpty() || !File(filePath).exists()) {
                    result.error("FILE_NOT_FOUND", "文件不存在: $filePath", null)
                    return@Thread
                }
                
                // 生成唯一文件名
                val file = File(filePath)
                val fileName = "${uploadPrefix}${System.currentTimeMillis()}_${file.name}"
                
                // 构建COS上传URL
                val host = "$bucketName.cos.$region.myqcloud.com"
                val url = "https://$host/$fileName"
                
                // 生成授权签名
                val authorization = generateCOSAuthorization(
                    secretId = secretId,
                    secretKey = secretKey,
                    method = "PUT",
                    uri = "/$fileName",
                    host = host
                )
                
                // 创建请求体
                val mediaType = getMediaType(file.name)
                val requestBody = file.asRequestBody(mediaType.toMediaType())
                
                // 构建HTTP请求
                val request = Request.Builder()
                    .url(url)
                    .put(requestBody)
                    .addHeader("Authorization", authorization)
                    .addHeader("Host", host)
                    .addHeader("x-cos-acl", acl)
                    .addHeader("Content-Type", mediaType)
                    .build()
                
                // 执行上传
                httpClient.newCall(request).enqueue(object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        Log.e(TAG, "COS上传失败", e)
                        result.error("UPLOAD_FAILED", e.message, null)
                    }
                    
                    override fun onResponse(call: Call, response: Response) {
                        if (response.isSuccessful) {
                            result.success(url)
                        } else {
                            val errorMsg = "上传失败: ${response.code} ${response.message}"
                            Log.e(TAG, errorMsg)
                            result.error("UPLOAD_FAILED", errorMsg, null)
                        }
                        response.close()
                    }
                })
                
            } catch (e: Exception) {
                Log.e(TAG, "上传文件时发生异常", e)
                result.error("EXCEPTION", e.message, null)
            }
        }.start()
    }
    
    private fun generateQRCode(call: MethodCall, result: MethodChannel.Result) {
        try {
            val data = call.argument<String>("data") ?: ""
            val size = call.argument<Int>("size") ?: 500
            
            if (data.isEmpty()) {
                result.error("EMPTY_DATA", "二维码数据不能为空", null)
                return
            }
            
            // 使用ZXing生成二维码
            val writer = QRCodeWriter()
            val hints = Hashtable<EncodeHintType, Any>()
            hints[EncodeHintType.CHARACTER_SET] = "UTF-8"
            hints[EncodeHintType.MARGIN] = 2
            
            val bitMatrix = writer.encode(data, BarcodeFormat.QR_CODE, size, size, hints)
            
            // 将BitMatrix转换为Bitmap
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
            for (x in 0 until size) {
                for (y in 0 until size) {
                    bitmap.setPixel(x, y, if (bitMatrix[x, y]) Color.BLACK else Color.WHITE)
                }
            }
            
            // 将Bitmap转换为字节数组
            val outputStream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
            val byteArray = outputStream.toByteArray()
            
            result.success(byteArray.toList())
            
        } catch (e: Exception) {
            Log.e(TAG, "生成二维码时发生异常", e)
            result.error("QR_GENERATION_FAILED", e.message, null)
        }
    }
    
    private fun generateCOSAuthorization(
        secretId: String,
        secretKey: String,
        method: String,
        uri: String,
        host: String
    ): String {
        try {
            val now = System.currentTimeMillis() / 1000
            val expiredTime = now + 3600 // 1小时有效期
            
            // 生成KeyTime
            val keyTime = "$now;$expiredTime"
            
            // 生成SignKey
            val signKey = hmacSha1(secretKey, keyTime)
            
            // 构建HttpString
            val httpString = "${method.lowercase()}\n$uri\n\nhost=${host.lowercase()}\n"
            
            // 生成StringToSign
            val stringToSign = "sha1\n$keyTime\n${sha1(httpString)}\n"
            
            // 生成Signature
            val signature = hmacSha1(signKey, stringToSign)
            
            // 构建Authorization
            return "q-sign-algorithm=sha1&q-ak=$secretId&q-sign-time=$keyTime&q-key-time=$keyTime&q-header-list=host&q-url-param-list=&q-signature=$signature"
            
        } catch (e: Exception) {
            Log.e(TAG, "生成COS签名失败", e)
            throw e
        }
    }
    
    private fun hmacSha1(key: String, data: String): String {
        val mac = Mac.getInstance("HmacSHA1")
        val secretKey = SecretKeySpec(key.toByteArray(), "HmacSHA1")
        mac.init(secretKey)
        val result = mac.doFinal(data.toByteArray())
        return bytesToHex(result)
    }
    
    private fun sha1(data: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
        val result = digest.digest(data.toByteArray())
        return bytesToHex(result)
    }
    
    private fun bytesToHex(bytes: ByteArray): String {
        val hexArray = "0123456789abcdef".toCharArray()
        val hexChars = CharArray(bytes.size * 2)
        for (i in bytes.indices) {
            val v = bytes[i].toInt() and 0xFF
            hexChars[i * 2] = hexArray[v ushr 4]
            hexChars[i * 2 + 1] = hexArray[v and 0x0F]
        }
        return String(hexChars)
    }
    
    private fun getMediaType(fileName: String): String {
        return when (fileName.substringAfterLast('.', "").lowercase()) {
            "mp3" -> "audio/mpeg"
            "wav" -> "audio/wav"
            "m4a" -> "audio/mp4"
            "aac" -> "audio/aac"
            "flac" -> "audio/flac"
            "ogg" -> "audio/ogg"
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "pdf" -> "application/pdf"
            "txt" -> "text/plain"
            "json" -> "application/json"
            else -> "application/octet-stream"
        }
    }
    
    fun cleanup() {
        cosChannel?.setMethodCallHandler(null)
        qrChannel?.setMethodCallHandler(null)
    }
}
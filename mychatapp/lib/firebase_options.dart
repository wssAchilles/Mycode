// lib/firebase_options.dart

// File generated manually based on your configuration files.
// ignore_for_file: lines_longer_than_80_chars, avoid_classes_with_only_static_members
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      // IMPORTANT: You still need to configure the 'web' section below
      // if you intend to support web.
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      case TargetPlatform.macOS:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for macos - '
              'you can reconfigure this by running the FlutterFire CLI again.',
        );
      case TargetPlatform.windows:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for windows - '
              'you can reconfigure this by running the FlutterFire CLI again.',
        );
      case TargetPlatform.linux:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for linux - '
              'you can reconfigure this by running the FlutterFire CLI again.',
        );
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported for this platform.',
        );
    }
  }

  // TODO: Paste your web config here if you have one.
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyAeou4kc-FoHSrLQphnsY3Hif6nXMVhNRs',
    appId: '1:700105397766:web:b13f5d3b747067de911587',
    messagingSenderId: '700105397766',
    projectId: 'mychatapp-2a819',
    authDomain: 'mychatapp-2a819.firebaseapp.com',
    storageBucket: 'mychatapp-2a819.firebasestorage.app',
  );

  // ========= ANDROID CONFIGURATION (COMPLETED FOR YOU) =========
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyD1DJCLqVGiVyevNCj2ttjn3Ibp7lbOGeE',
    appId: '1:700105397766:android:5bcf4c2adc9c3845911587',
    messagingSenderId: '700105397766',
    projectId: 'mychatapp-2a819',
    storageBucket: 'mychatapp-2a819.firebasestorage.app',
  );

  // ========= IOS CONFIGURATION (COMPLETED FOR YOU) =========
  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyDo8dHxDIXaG8owGf3o0j74auAP6zQluaQ',
    appId: '1:700105397766:ios:40cf5d63a418da9e911587',
    messagingSenderId: '700105397766',
    projectId: 'mychatapp-2a819',
    storageBucket: 'mychatapp-2a819.firebasestorage.app',
    iosBundleId: 'com.mychatapp.xzq.mychatapp',
  );
}
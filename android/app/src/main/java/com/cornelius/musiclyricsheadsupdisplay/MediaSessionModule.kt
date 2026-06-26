package com.cornelius.musiclyricsheadsupdisplay

import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MediaSessionModule(private val reactApplicationContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactApplicationContext) {

    companion object {
        var reactContext: ReactApplicationContext? = null
    }

    init {
        reactContext = reactApplicationContext
    }

    override fun getName(): String = "MediaSessionModule"

    @ReactMethod
    fun isNotificationAccessGranted(promise: Promise) {
        val enabledPackages = NotificationManagerCompat
            .getEnabledListenerPackages(reactApplicationContext)

        val granted = enabledPackages.contains(reactApplicationContext.packageName)
        promise.resolve(granted)
    }

    @ReactMethod
    fun openNotificationSettings() {
        val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}

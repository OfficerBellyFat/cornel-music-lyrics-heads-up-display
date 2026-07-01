const fs = require("fs");
const path = require("path");
const {
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} = require("expo/config-plugins");

function assertAndroidPackage(config) {
  const pkg = config?.android?.package;
  if (!pkg) {
    throw new Error("expo.android.package must be defined for with-media-session plugin.");
  }
  return pkg;
}

function moduleSource(pkg) {
  return `package ${pkg}

import android.content.Context
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
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
        val flat = Settings.Secure.getString(reactApplicationContext.contentResolver, "enabled_notification_listeners")

        val granted = flat != null && flat.contains(reactApplicationContext.packageName)
        promise.resolve(granted)
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations() {
        val packageName = reactApplicationContext.packageName
        val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager

        if(!pm.isIgnoringBatteryOptimizations(packageName)) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
        }
    }

    @ReactMethod
    fun openNotificationSettings() {
        val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
    }

    @ReactMethod
    fun refreshCurrentMediaState() {
        MediaListenerService.instance?.refreshCurrentMediaState()
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
`;
}

function packageSource(pkg) {
  return `package ${pkg}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MediaSessionPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> {
        return listOf(MediaSessionModule(reactContext))
    }

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;
}

function listenerSource(pkg) {
  return `package ${pkg}

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class MediaListenerService : NotificationListenerService() {
    private var mediaSessionManager: MediaSessionManager? = null
    private var activeController: MediaController? = null

    companion object {
        var instance: MediaListenerService? = null
    }

    private val sessionListener =
        MediaSessionManager.OnActiveSessionsChangedListener { controllers -> handleSessionChange(controllers) }

    private val controllerCallback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) {
            metadata ?: return
            emitMediaState(metadata, activeController?.playbackState)
        }

        override fun onPlaybackStateChanged(state: PlaybackState?) {
            state ?: return
            emitMediaState(activeController?.metadata, state)
        }
    }

    override fun onListenerConnected() {
        instance = this
        mediaSessionManager = getSystemService(MEDIA_SESSION_SERVICE) as? MediaSessionManager
        val component = ComponentName(this, MediaListenerService::class.java)
        mediaSessionManager?.addOnActiveSessionsChangedListener(sessionListener, component)
        val currentSessions = mediaSessionManager?.getActiveSessions(component)
        handleSessionChange(currentSessions)
    }

    override fun onListenerDisconnected() {
        mediaSessionManager?.removeOnActiveSessionsChangedListener(sessionListener)
        activeController?.unregisterCallback(controllerCallback)
        activeController = null
        instance = null
    }

    fun refreshCurrentMediaState() {
        val component = ComponentName(this, MediaListenerService::class.java)
        val currentSessions = mediaSessionManager?.getActiveSessions(component)

        if (!currentSessions.isNullOrEmpty()) {
            handleSessionChange(currentSessions)
            return
        }

        emitMediaState(activeController?.metadata, activeController?.playbackState)
    }

    private fun handleSessionChange(controllers: List<MediaController>?) {
        activeController?.unregisterCallback(controllerCallback)
        activeController = null
        val playing = controllers?.firstOrNull {
            it.playbackState?.state == PlaybackState.STATE_PLAYING
        } ?: controllers?.firstOrNull()

        playing?.let {
            activeController = it
            it.registerCallback(controllerCallback)
            emitMediaState(it.metadata, it.playbackState)
        }
    }

    private fun emitMediaState(metadata: MediaMetadata?, state: PlaybackState?) {
        val reactContext = MediaSessionModule.reactContext ?: return
        val title = metadata?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: return
        val artist = metadata.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: ""

        val isPlaying = state?.state == PlaybackState.STATE_PLAYING

        val positionMs = if (isPlaying && state != null) {
            state.position + (SystemClock.elapsedRealtime() - state.lastPositionUpdateTime)
        } else {
            state?.position ?: 0L
        }

        val payload: WritableMap = Arguments.createMap().apply {
            putString("title", title)
            putString("artist", artist)
            putBoolean("isPlaying", isPlaying)
            putDouble("positionMs", positionMs.toDouble())
        }

        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("OnMediaStateChanged", payload)
    }
}
`;
}

const withMediaSessionFiles = (config) =>
  withDangerousMod(config, [
    "android",
    async (config) => {
      const pkg = assertAndroidPackage(config);
      const pkgPath = pkg.split(".").join(path.sep);
      const javaDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        pkgPath
      );

      await fs.promises.mkdir(javaDir, { recursive: true });
      await fs.promises.writeFile(path.join(javaDir, "MediaSessionModule.kt"), moduleSource(pkg), "utf8");
      await fs.promises.writeFile(path.join(javaDir, "MediaSessionPackage.kt"), packageSource(pkg), "utf8");
      await fs.promises.writeFile(path.join(javaDir, "MediaListenerService.kt"), listenerSource(pkg), "utf8");

      return config;
    },
  ]);

const withMediaSessionMainApplication = (config) =>
  withMainApplication(config, (config) => {
    let src = config.modResults.contents;
    if (!src.includes("add(MediaSessionPackage())")) {
      src = src.replace(
        "PackageList(this).packages.apply {",
        "PackageList(this).packages.apply {\n add(MediaSessionPackage())"
      );
    }
    config.modResults.contents = src;
    return config;
  });

const withMediaSessionMainActivity = (config) =>
  withMainActivity(config, (config) => {
    let src = config.modResults.contents;

    if (!src.includes("com.facebook.react.modules.core.DeviceEventManagerModule")) {
      src = src.replace(
        "import com.facebook.react.ReactActivityDelegate",
        "import com.facebook.react.ReactActivityDelegate\nimport com.facebook.react.modules.core.DeviceEventManagerModule"
      );
    }

    if (!src.includes('emit("OnAppResume", null)')) {
      const onResumeBlock = `

  override fun onResume() {
    super.onResume()
    val reactContext = MediaSessionModule.reactContext ?: return

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("OnAppResume", null)
  }
`;
      src = src.replace("  /**\n    * Align the back button behavior with Android S", `${onResumeBlock}\n  /**\n    * Align the back button behavior with Android S`);
    }

    config.modResults.contents = src;
    return config;
  });

const withMediaSessionManifest = (config) =>
  withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];

    const hasBindPermission = manifest["uses-permission"].some(
      (item) => item?.$?.["android:name"] === "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
    );
    if (!hasBindPermission) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" },
      });
    }

    const hasBatteryPermission = manifest["uses-permission"].some(
      (item) => item?.$?.["android:name"] === "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
    );
    if (!hasBatteryPermission) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" },
      });
    }

    const app = manifest.application?.[0];
    if (!app) {
      return config;
    }
    app.service = app.service || [];
    const hasService = app.service.some(
      (service) => service?.$?.["android:name"] === ".MediaListenerService"
    );

    if (!hasService) {
      app.service.push({
        $: {
          "android:name": ".MediaListenerService",
          "android:label": "Media Listener Service",
          "android:permission": "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
          "android:exported": "true",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "android.service.notification.NotificationListenerService",
                },
              },
            ],
          },
        ],
      });
    }

    return config;
  });

const withMediaSession = (config) => {
  config = withMediaSessionFiles(config);
  config = withMediaSessionMainApplication(config);
  config = withMediaSessionMainActivity(config);
  config = withMediaSessionManifest(config);
  return config;
};

module.exports = createRunOncePlugin(withMediaSession, "with-media-session", "1.0.0");

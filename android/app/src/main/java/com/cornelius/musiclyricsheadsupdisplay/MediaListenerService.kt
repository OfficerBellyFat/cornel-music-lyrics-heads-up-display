package com.cornelius.musiclyricsheadsupdisplay

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
        mediaSessionManager = getSystemService(MEDIA_SESSION_SERVICE) as MediaSessionManager
        val component = ComponentName(this, MediaListenerService::class.java)
        mediaSessionManager?.addOnActiveSessionsChangedListener(sessionListener, component)
        val currentSessions = mediaSessionManager?.getActiveSessions(component)
        handleSessionChange(currentSessions)
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

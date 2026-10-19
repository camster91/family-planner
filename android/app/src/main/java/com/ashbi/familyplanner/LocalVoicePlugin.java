package com.ashbi.familyplanner;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.net.URI;
import java.util.ArrayList;

/** Foreground, one-utterance local transcription only. No audio storage, writes or identity. */
@CapacitorPlugin(name = "LocalVoice", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class LocalVoicePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall pending;
    private Runnable deadline;
    private boolean foreground = true;
    private boolean permissionInFlight;
    private String permissionStopStatus;

    private boolean trustedPage() {
        try {
            URI uri = new URI(getBridge().getWebView().getUrl());
            return "https".equals(uri.getScheme()) && "family.ashbi.ca".equals(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception ignored) { return false; }
    }

    private boolean available() {
        return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }

    private void finish(PluginCall call, String status, String text) {
        if (pending != call) return;
        // Capacitor must retain its saved permission call until the system
        // callback arrives. Cancellation still prevents recognition from starting.
        if (permissionInFlight) { permissionStopStatus = status; return; }
        pending = null;
        if (deadline != null) main.removeCallbacks(deadline);
        deadline = null;
        SpeechRecognizer old = recognizer;
        recognizer = null;
        if (old != null) {
            try { old.cancel(); } catch (RuntimeException ignored) { }
            try { old.destroy(); } catch (RuntimeException ignored) { }
        }
        JSObject result = new JSObject();
        result.put("status", status);
        if (text != null) result.put("text", text.substring(0, Math.min(text.length(), 2000)));
        call.resolve(result);
    }

    @PluginMethod
    public void availability(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            boolean supported;
            try { supported = trustedPage() && available(); } catch (RuntimeException ignored) { supported = false; }
            result.put("available", supported);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void listen(PluginCall call) {
        main.post(() -> {
            if (pending != null || permissionInFlight) { call.reject("Voice is busy", "BUSY"); return; }
            String requestId = call.getString("requestId", "");
            if (!requestId.matches("[A-Za-z0-9_-]{16,128}")) { call.reject("Invalid voice request", "INVALID_REQUEST"); return; }
            pending = call;
            permissionStopStatus = null;
            if (!foreground || !trustedPage()) { finish(call, "cancelled", null); return; }
            try {
                if (!available()) { finish(call, "unavailable", null); return; }
                deadline = () -> finish(call, "timeout", null);
                main.postDelayed(deadline, 20_000L);
                if (getPermissionState("microphone") != PermissionState.GRANTED) {
                    permissionInFlight = true;
                    requestPermissionForAlias("microphone", call, "microphoneResult");
                } else begin(call);
            } catch (RuntimeException ignored) { permissionInFlight = false; finish(call, "unavailable", null); }
        });
    }

    @PermissionCallback
    private void microphoneResult(PluginCall call) {
        main.post(() -> {
            permissionInFlight = false;
            if (pending != call) return;
            if (permissionStopStatus != null) { finish(call, permissionStopStatus, null); permissionStopStatus = null; return; }
            if (!foreground || !trustedPage()) { finish(call, "cancelled", null); return; }
            if (getPermissionState("microphone") != PermissionState.GRANTED) { finish(call, "denied", null); return; }
            begin(call);
        });
    }

    private void begin(PluginCall call) {
        if (pending != call) return;
        try {
            if (!available()) { finish(call, "unavailable", null); return; }
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle params) { }
                public void onBeginningOfSpeech() { }
                public void onRmsChanged(float rms) { }
                public void onBufferReceived(byte[] buffer) { } // Never retain audio.
                public void onEndOfSpeech() { }
                public void onPartialResults(Bundle results) { }
                public void onEvent(int eventType, Bundle params) { }
                public void onError(int error) {
                    String status = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "denied"
                        : error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "no-input" : "unavailable";
                    finish(call, status, null);
                }
                public void onResults(Bundle results) {
                    if (!foreground || !trustedPage()) { finish(call, "cancelled", null); return; }
                    ArrayList<String> values = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String text = values == null || values.isEmpty() ? "" : values.get(0);
                    finish(call, text == null || text.trim().isEmpty() ? "no-input" : "transcript", text);
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es".equals(call.getString("language")) ? "es-ES" : "en-US");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            recognizer.startListening(intent);
        } catch (RuntimeException ignored) { finish(call, "unavailable", null); }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            if (pending != null && call.getString("requestId", "").equals(pending.getString("requestId")))
                finish(pending, "cancelled", null);
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        foreground = false;
        main.post(() -> { if (pending != null) finish(pending, "cancelled", null); });
    }

    @Override
    protected void handleOnResume() { foreground = true; }

    @Override
    protected void handleOnDestroy() {
        foreground = false;
        main.post(() -> { if (pending != null) finish(pending, "cancelled", null); });
    }
}

from google.genai import types

# This Live model only supports an AUDIO response — it will speak a reply we never play back.
# We only read server_content.input_transcription from the stream and discard everything else
# (model_turn audio bytes, output_transcription), so the wasted generation doesn't reach the UI
# or add to what the user waits on; input_transcription arrives as soon as the turn is detected,
# independent of the trailing audio reply still streaming in behind it.
_SYSTEM_INSTRUCTION = (
    "You are a silent transcription engine, not a conversational assistant. Never respond to, "
    "comment on, or answer anything said."
)


def build_live_config() -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=_SYSTEM_INSTRUCTION,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                prefix_padding_ms=100,
                silence_duration_ms=400,
            ),
            turn_coverage=types.TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
            # New speech must cut off the model's own (unwanted, unplayed) spoken reply from the
            # previous turn — otherwise the session stays "busy" finishing that reply and silently
            # drops audio the user speaks in the meantime.
            activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        ),
    )

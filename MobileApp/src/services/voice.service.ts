let Voice: any = null;

try {
  // Lazy-load to avoid crashing in Expo Go (module not available there).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Voice = require('@react-native-voice/voice').default || require('@react-native-voice/voice');
} catch (error) {
  Voice = null;
}

type VoiceHandlers = {
  onResult: (text: string) => void;
  onError?: (message: string) => void;
  onStateChange?: (listening: boolean) => void;
};

type VoiceResultEvent = { value?: string[] };
type VoiceErrorEvent = { error?: { message?: string } };

class VoiceService {
  private handlers: VoiceHandlers | null = null;
  private listening = false;

  initialize(handlers: VoiceHandlers) {
    this.handlers = handlers;
    if (!Voice) return;
    Voice.onSpeechStart = () => {
      this.listening = true;
      this.handlers?.onStateChange?.(true);
    };
    Voice.onSpeechEnd = () => {
      this.listening = false;
      this.handlers?.onStateChange?.(false);
    };
    Voice.onSpeechResults = (event: VoiceResultEvent) => {
      const results = event.value || [];
      const top = results[0];
      if (top) {
        this.handlers?.onResult(top);
      }
    };
    Voice.onSpeechError = (event: VoiceErrorEvent) => {
      const message = event.error?.message || 'Voice error';
      this.handlers?.onError?.(message);
      this.handlers?.onStateChange?.(false);
      this.listening = false;
    };
  }

  async start(locale: string) {
    if (!Voice) return;
    try {
      await Voice.start(locale);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Voice start failed';
      this.handlers?.onError?.(message);
    }
  }

  async stop() {
    if (!Voice) return;
    try {
      await Voice.stop();
    } catch {
      // ignore
    }
  }

  async destroy() {
    if (!Voice) return;
    try {
      await Voice.destroy();
      await Voice.removeAllListeners();
    } catch {
      // ignore
    }
  }

  isListening() {
    return this.listening;
  }
}

export const voiceService = new VoiceService();

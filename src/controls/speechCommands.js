export function initSpeechCommands({ onTranscript } = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported in this browser.');
    return { start: () => {}, stop: () => {} };
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        const transcript = result[0].transcript.trim();
        if (transcript && typeof onTranscript === 'function') {
          try {
            onTranscript(transcript);
          } catch (err) {
            console.error('Error handling transcript', err);
          }
        }
      }
    }
  };

  recognition.onerror = (e) => {
    console.error('Speech recognition error:', e);
  };

  recognition.onnomatch = () => {
    console.warn('Speech not detected.');
  };

  let active = false;

  recognition.onend = () => {
    if (active) {
      // Restart automatically to keep listening
      recognition.start();
    }
  };

  return {
    start: () => {
      active = true;
      try { recognition.start(); } catch (err) {
        console.error('Failed to start speech recognition:', err);
      }
    },
    stop: () => {
      active = false;
      recognition.stop();
    }
  };
}

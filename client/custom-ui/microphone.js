//AIS-797: microphone functionality
export function patchSpeechRecognition() {
  var SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  var originalStart;
  var originalStop;

  if (!SpeechRecognition || SpeechRecognition.prototype._kaitMicPatched) {
    return;
  }

  SpeechRecognition.prototype._kaitMicPatched = true;

  originalStop = SpeechRecognition.prototype.stop;
  SpeechRecognition.prototype.stop = function () {
    this._kaitManuallyStopped = true;
    return originalStop.apply(this, arguments);
  };

  originalStart = SpeechRecognition.prototype.start;
  SpeechRecognition.prototype.start = function () {
    var recognition = this;

    this.continuous = true;
    this.interimResults = true;

    if (!this._kaitEndPatched) {
      this._kaitEndPatched = true;
      this.addEventListener("end", function () {
        if (!recognition._kaitManuallyStopped) {
          try {
            recognition.start();
          } catch (error) {
            // start() throws if recognition is already running
          }
        }

        recognition._kaitManuallyStopped = false;
      });
    }

    return originalStart.apply(this, arguments);
  };
}

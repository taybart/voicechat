export default class PeerConnection {
  constructor(id, target, signaling, stream, onConnect, onClose, onDisconnect) {
    this.id = id;
    this.target = target;
    this.signaling = signaling
    this.stream = stream;

    this.onConnect = onConnect;
    this.onClose = onClose;
    this.onDisconnect = onDisconnect;

    this.pc = new RTCPeerConnection();

    this.pc.onicecandidate = e => {
      if (e.candidate) {
        this.signaling.sendToServer({
          type: "new-ice-candidate",
          id,
          target,
          candidate: e.candidate
        });
      }
    };

    this.pc.oniceconnectionstatechange = event => {
      switch (this.pc.iceConnectionState) {
        case "connected":
          this.onConnect(target)
          break;
        case "closed":
          document.getElementById(this.target).remove()
          this.onClose(target);
          break;
        case "failed":
        case "disconnected":
          document.getElementById(this.target).remove()
          this.onDisconnect(target);
          break;
        default: break;
      }
    };
    this.pc.onsignalingstatechange = event => {
      console.log(event)
      switch (this.pc.signalingState) {
        case "closed":
          break;
        default: break;
      }
    };

    this.pc.ontrack = (e) => {
      const output = document.getElementById("output")
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.id = this.target;
      console.log("AUDIO STREAMS", e.streams)
      if (audio.srcObject !== e.streams[0]) {
        audio.srcObject = e.streams[0];
        console.log('Received remote stream');
        output.appendChild(audio);
      }
    };

    console.log('Adding Local Stream to peer connection');
    this.stream.getAudioTracks().forEach(track => this.pc.addTrack(track, this.stream));
    console.log('Created peer connection object');
  }

  call = () => {
    this.pc.onnegotiationneeded = () => {
      this.pc.createOffer({
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 0,
        voiceActivityDetection: false
      }).then(offer => this.pc.setLocalDescription(offer))
        .then(() =>
          this.signaling.sendToServer({
            id: this.id,
            target: this.target,
            type: "connection-offer",
            sdp: this.pc.localDescription
          })
        ).catch(console.error);
    }
  };

  accept = (sdp) => new Promise((resolve, reject) => { 
    console.log("accepting call", this.id, this.target)
    this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
      .then(() => this.pc.createAnswer())
      .then(answer => this.pc.setLocalDescription(answer))
      .then(() => {
        this.signaling.sendToServer({
          id: this.id,
          target: this.target,
          type: "connection-answer",
          sdp: this.pc.localDescription,
        });
        resolve();
      }).catch(reject);
  });
}

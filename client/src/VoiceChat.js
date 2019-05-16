import React, { Component } from 'react';
import SignalingConnection from "./SignalingConnection.js";

export default class VoiceChat extends Component {
  state = {
    connected: {},
    localStream: null,
    // id: localStorage.getItem('id') || null,
    id: null,
    inChat: false,
    username: localStorage.getItem('username') || 'test',
    userlist: []
  };
  stream = null;
  pcs = {};
  local = null;
  remote = null;
  codecSelector = React.createRef();
  audio = React.createRef();
  signalingConnection = null;

  setUsername = () => {
    const { username, id } = this.state;
    localStorage.setItem('username', username)
    this.signalingConnection.sendToServer({
      id,
      username,
      type: "username",
    });
  };

  changeUsername = event => {
    localStorage.setItem('username', event.target.value)
    this.setState({ username: event.target.value });
  };

  componentDidMount() {
    this.signalingConnection = new SignalingConnection({
      socketURL: "localhost:8080/ws",
      secure: false,
      onOpen: () => {
      },
      onMessage: this.onSignalingMessage
    });

    console.log('Requesting local stream');
    this.getStream();
  }


  getStream = () => new Promise((resolve, reject) => {
    if (this.stream) {
      resolve();
      return
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false }).then((stream) => {
        this.stream = stream;
        console.log('Received local stream');
        resolve()
      }).catch(reject);
  });
  onSignalingMessage = msg => {
    console.log(msg)
    switch (msg.type) {
      case "id":
        // localStorage.setItem("id", msg.id)
        this.setState({ id: msg.id });
        this.setUsername();
        break;

      case "username-reject":
        this.setState({ username: msg.username });
        console.log(`username changed to <${msg.username}> to avoid conflict`);
        break;

      case "userlist-populate": // Received an updated user list
        this.setState({ userlist: msg.users });
        if (this.state.inChat) {
          const userIds = Object.keys(msg.users).filter(i => i !== this.state.id);
          userIds.forEach(id => this.call(id))
        }
        break;
      case "userlist-update": // Received an updated user list
        if (msg.action === 'add') {
          this.setState({ userlist: {
            ...this.state.userlist,
            [msg.id]: msg.username,
          }});
        } else if (msg.action === 'delete') {
          const userlist = this.state.userlist;
          delete userlist[msg.id]
          this.setState({ userlist });
        }
        break;

      case "connection-offer": // Invitation and offer to chat
        this.newPeerConnection(msg.id);
        this.accept(msg.id, msg.sdp);
        break;

      case "connection-answer": // Callee has answered our offer
        this.pcs[msg.id].setRemoteDescription(new RTCSessionDescription(msg.sdp))
          .catch(console.error);
        /* this.signalingConnection.sendToServer({
          id: this.state.id,
          type: "status",
          action: "set",
          status: "connected",
        }); */
        break;

      case "new-ice-candidate": // A new ICE candidate has been received
        this.pcs[msg.id].addIceCandidate(new RTCIceCandidate(msg.candidate));
        break;

      default: break;
    }
  };

  close = (id) => {
    if (!id) {
      Object.keys(this.pcs).forEach(id => {
        console.log("Attempting to close", id);
        this.pcs[id].close();
        // delete this.pcs[id];
      });
    } else if (this.pcs[id]) {
      this.pcs[id].close();
      // delete this.pcs[id]
    }
    this.setState({ connected: false });
  }

  accept = (target, sdp) => {
    const { id } = this.state;
    console.log("accepting call", id, target)
    this.pcs[target].setRemoteDescription(new RTCSessionDescription(sdp))
      .then(() => this.pcs[target].createAnswer())
      .then(answer => this.pcs[target].setLocalDescription(answer))
      .then(() => {
        this.signalingConnection.sendToServer({
          id,
          target,
          type: "connection-answer",
          sdp: this.pcs[target].localDescription,
        });
        this.setState({ connected: true })
      }).catch(console.error);
  };

  newPeerConnection = (target) => {
    const { id } = this.state;
    if (!this.pcs[target]) {
      this.pcs[target] = new RTCPeerConnection();
      this.pcs[target].onicecandidate = e => {
        if (e.candidate) {
          this.signalingConnection.sendToServer({
            type: "new-ice-candidate",
            id,
            target,
            candidate: e.candidate
          });
        }
      };

      this.pcs[target].oniceconnectionstatechange = event => {
        switch (this.pcs[target].iceConnectionState) {
          case "connected":
            console.log("CONNECTED", target)
            this.setState({ connected: {
              ...this.state.connected,
              [target]: "green"
            }})
            break;
          case "closed":
            console.log("CLOSED", target)
            this.setState({ connected: {
              ...this.state.connected,
              [target]: "purple"
            }})
            this.close(target);
            break;
          case "failed":
          case "disconnected":
            console.log("DISCONNECTED ", target)
            this.setState({ connected: {
              ...this.state.connected,
              [target]: "red"
            }})
            this.close(target);
            break;
          default: break;
        }
      };

      this.pcs[target].onsignalingstatechange = event => {
        console.log(event)
        switch (this.pcs[target].signalingState) {
          case "closed":
            delete this.pcs[target];
            break;
          default: break;
        }
      };

      this.pcs[target].ontrack = (e) => {
        if (this.audio.current.srcObject !== e.streams[0]) {
          this.audio.current.srcObject = e.streams[0];
          console.log('Received remote stream');
        }
      };

      // const audioTracks = this.stream.getAudioTracks();
      console.log('Adding Local Stream to peer connection');
      this.stream.getAudioTracks().forEach(track => this.pcs[target].addTrack(track, this.stream));
      console.log('Created peer connection object');
    }
  }

  call = (target) => {
    this.getStream().then(() => {
      this.newPeerConnection(target);
      this.pcs[target].onnegotiationneeded = () => {
        const { id } = this.state;
        this.pcs[target].createOffer({
          offerToReceiveAudio: 1,
          offerToReceiveVideo: 0,
          voiceActivityDetection: false
        }).then(offer => this.pcs[target].setLocalDescription(offer))
          .then(() =>
            this.signalingConnection.sendToServer({
              id,
              target,
              type: "connection-offer",
              sdp: this.pcs[target].localDescription
            })
          ).catch(console.error);
      }
    }).catch(e => alert(e));
  };

  render() {
    const { connected, userlist, id } = this.state;
    const userIds = Object.keys(userlist).filter(i => i !== id);
    // userIds.forEach(id => this.call(id))

    return (<div>
      <audio ref={this.audio} autoPlay controls></audio>
      <button disabled={!connected} onClick={() => this.close()}>Hang Up</button>
      <div>
        <button onClick={() => {
          if (!this.state.id) {
            this.signalingConnection.sendToServer({
              type: "id",
              action: "request",
            });
          } else {
            this.signalingConnection.sendToServer({
              type: "id",
              action: "set",
              id: this.state.id,
            });
          }
          this.setState({ inChat: true })
        }}>
        Join Chat
      </button>
      <ul>
        {userIds.map(id => (
          <li key={id}>
            <button style={{backgroundColor: connected[id]}} onClick={() => this.call(id)}>Call {userlist[id]}</button>
          </li>
        ))}
      </ul>
    </div>
  </div>);
  }
}

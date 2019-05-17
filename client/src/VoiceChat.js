import React, { Component } from 'react';
import PeerConnection from './PeerConnection.js';
import SignalingConnection from './SignalingConnection.js';

export default class VoiceChat extends Component {
  state = {
    connected: {},
    // id: localStorage.getItem('id') || null,
    id: null,
    inChat: false,
    username: (localStorage.getItem('username') || 'User'),
    userlist: [],
    userIds: [],
  };
  input = React.createRef();
  stream = null;
  pcs = {};
  signaling = null;

  setUsername = (username) => {
    const { id } = this.state;
    localStorage.setItem('username', username)
    this.signaling.sendToServer({
      id,
      username,
      type: "username",
    });
    this.setState({ username });
  };

  getStream = () => new Promise((resolve, reject) => {
    if (this.stream) {
      resolve();
      return
    }
    console.log('Requesting local stream');
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false }).then((stream) => {
        this.stream = stream;
        console.log('Received local stream');
        resolve()
      }).catch(reject);
  });

  onSignalingMessage = msg => {
    // console.log(msg)
    switch (msg.type) {
      case "id":
        localStorage.setItem("id", msg.id)
        this.setState({ id: msg.id });
        this.setUsername(this.state.username);
        break;

      case "username-reject":
        this.setState({ username: msg.username });
        console.log(`username changed to <${msg.username}> to avoid conflict`);
        break;

      case "userlist-populate": // Received an updated user list
        const userIds = Object.keys(msg.users).filter(i => i !== this.state.id);
        this.setState({ userIds, userlist: msg.users });
        if (this.state.inChat) {
          userIds.forEach(id => this.call(id))
        }
        break;
      case "userlist-update": // Received an updated user list
        if (msg.action === 'add') {
          const userIds = this.state.userIds;
          userIds.push(msg.id);
          this.setState({
            userIds,
            userlist: {
              ...this.state.userlist,
              [msg.id]: msg.username,
            }
          });
        } else if (msg.action === 'delete') {
          const userlist = this.state.userlist;
          delete userlist[msg.id]
          const userIds = this.state.userIds.filter(id => id !== msg.id)
          this.setState({ userIds, userlist });
        } else if (msg.action === 'update') {
          console.log('update')
          this.setState({
            userlist: {
              ...this.state.userlist,
              [msg.id]: msg.username,
            }
          });
        }
        break;

      case "connection-offer": // Invitation and offer to chat
        this.getStream().then(() => {
          this.pcs[msg.id] =  this.newPeerConnection(msg.id);
          this.pcs[msg.id].accept(msg.sdp);
        });
        break;

      case "connection-answer": // Callee has answered our offer
        this.pcs[msg.id].pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          .catch(console.error);
        break;

      case "new-ice-candidate":
        this.pcs[msg.id].pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        break;

      default: break;
    }
  };

  newPeerConnection = (target) => {
    return new PeerConnection(
      this.state.id,
      target,
      this.signaling,
      this.stream,
      this.onConnect,
      this.onClose,
      this.onDisconnect,
    );
  }

  onConnect = (target) => {
    console.log("CONNECTED", target)
    this.setState({ connected: {
      ...this.state.connected,
      [target]: "green"
    }})
  }
  onClose = (target) => {
    console.log("CLOSED", target)
    this.setState({ connected: {
      ...this.state.connected,
      [target]: "purple"
    }})
  }
  onDisconnect = (target) => {
    console.log("DISCONNECTED ", target)
    this.setState({ connected: {
      ...this.state.connected,
      [target]: "red"
    }})

  }

  joinChat = () => {
    this.getStream().then(() => {
      this.signaling.sendToServer({
        id: this.state.id,
        type: "status",
        action: "set",
        status: "connected",
      });
      const { userIds } = this.state;
      userIds.forEach(id => this.call(id));
      this.setState({ inChat: true });
    });
  }

  leaveChat = () => {
    this.signaling.sendToServer({
      id: this.state.id,
      type: "status",
      action: "set",
      status: "disconnected",
    });
    Object.keys(this.pcs).forEach(id => {
      console.log("Attempting to close", id);
      this.pcs[id].pc.close();
    });
    this.stream.getTracks().forEach(track => track.stop())
    this.stream = null;
    this.setState({ inChat: false, userlist: [], userIds: [] });
  }

  close = (id) => {
    if (this.pcs[id]) {
      this.pcs[id].pc.close();
    }
  }

  call = (target) => {
    this.getStream().then(() => {
      this.pcs[target] = this.newPeerConnection(target);
      this.pcs[target].call()
    }).catch(e => alert(e));
  };

  componentDidMount() {
    this.signaling = new SignalingConnection({
      socketURL: "localhost:8080/ws",
      secure: false,
      onOpen: () => {
        const { id } = this.state;
        if (id) {
          this.signaling.sendToServer({
            id,
            type: "id",
            action: "set",
          });
        } else {
          this.signaling.sendToServer({
            type: "id",
            action: "request",
          });
        }
      },
      onMessage: this.onSignalingMessage
    });
  }

  render() {
    const { username, inChat, userIds, userlist } = this.state;
    return (<div className="container">
      <div className="username">
        <form onSubmit={(e) => {
          e.preventDefault();
          this.input.current.classList.remove('transparent');
          setTimeout(() => this.input.current.classList.add('transparent'), 10);
          this.setUsername();
        }}>
        <label>
          Hello
          <input
            ref={this.input}
            className="transparent"
            type="text"
            value={username}
            onChange={(e) => this.setState({ username: e.target.value })}
          />
        </label>
      </form>
      {inChat ?
          (<button className="btn-tb btn-join-leave" onClick={this.leaveChat}>Leave Chat</button>) :
          (<button className="btn-tb btn-join-leave" onClick={this.joinChat}> Join Chat </button>)
      }
    </div>
    {inChat ?  <ul className="userlist"> {userIds.map(id => (<li key={id}> {userlist[id]} </li>))} </ul> : null}

    <div id="output" />
  </div>);
  }
}

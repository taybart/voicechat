export default class SignalingConnection {
  connection = null;
  messageListeners = []

  constructor({ socketURL, secure, onOpen, onMessage }) {
    this.socketURL = socketURL;
    this.onOpen = onOpen;
    this.messageListeners = [onMessage]
    this.connectToSocket(secure || false);
  }

  sendToServer = msg => {
    const msgJSON = JSON.stringify(msg);
    this.connection.send(msgJSON);
  };

  connectToSocket = (secure) => {
    let serverUrl = `ws://${this.socketURL}`;
    if (secure) {
      serverUrl = `wss://${this.socketURL}`;
    }

    this.connection = new WebSocket(serverUrl, "json");
    this.connection.onopen = () => this.onOpen()

    this.connection.onmessage = event => {
      let msg = JSON.parse(event.data);

      this.messageListeners.forEach(func => func(msg))
    }
  };

  addMsgListener = func => {
    this.messageListeners = [...this.messageListeners, func]
    return () => {
      this.messageListeners = this.messageListeners.filter(f => f !== func)
    }
  }
};

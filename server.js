const WebSocket = require("ws");
const fs = require("fs");
const express = require("express");

// ########### STATIC FILES SERVER

const cPort = process.env.PORT || 8080
const fserver = express()
    .use(express.static(__dirname + '/static'))
    .listen(cPort, () => {console.log(`Listening on port ${cPort}`)});

// ########### GAME SERVER

const cCardsPerHand = 7;
const cMinPlayers = 3;
const cPlayerReconnectionTimeout = 90000;

function Shuffle(v) {
  for (let i = v.length - 1; i > 1; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [v[i], v[j]] = [v[j], v[i]];
  }
}

Number.prototype.mod = function(n) {
  return ((this%n)+n)%n;
};

function UUID(length = 8) {
  return [...Array(length).keys()].map(x => Math.floor(Math.random() * 16).toString(16)).join("");
}

function ReadCards(filename) {
  const file_content = fs.readFileSync(filename, "utf8");
  return file_content.split("\n").map(x => x.replace(/\\n/g, "\n").trim()).filter(x => x.length > 0);
}

const white_cards = ReadCards("white.txt");
const black_cards = ReadCards("black.txt");

console.log(`${white_cards.length} white cards | ${black_cards.length} black cards`)

class CardDealer {
  constructor(deck) {
    this.deck = Array.from(deck);
    Shuffle(this.deck);
    this.returned = [];
  }

  DealOne() {
    if (this.deck.length == 0) {
      [this.deck, this.returned] = [this.returned, this.deck];
      Shuffle(this.deck);
    }
    return this.deck.pop();
  }

  ReturnOne(card) {
    this.returned.push(card);
  }
}


const States = Object.freeze({
  waiting:   Symbol("waiting_for_players"),
  campaign:  Symbol("campaign"),
  election:  Symbol("election")
});

class Room {
  constructor(name, rooms) {
    this.name = name;
    this.black_dealer = new CardDealer(black_cards);
    this.white_dealer = new CardDealer(white_cards);
    this.players = [];
    this.trump_idx = -1;
    this.trump = undefined;
    this.year = 0;

    this.black = undefined;
    this.black_holes = 0;

    this.election = undefined;
    this.last_election = undefined;
    this.state = States.waiting;

    this.rooms = rooms;
    this.rooms.set(this.name, this);
  }

  AddPlayer(player) {
    for (let i = 0; i < cCardsPerHand; i++) player.hand.push(this.white_dealer.DealOne());
    this.players.push(player);
    if (this.players.length === cMinPlayers) {
      this.StartCampaign();
    } else {
      this.UpdatePlayerWithInfo(player);
    }
  }

  DeleteRoom() {
    this.rooms.delete(this.name);
  }

  CheckAllDone() {
    let all_done = true;
    for (let player of this.players) {
      if (player === this.trump) continue;
      all_done = all_done && player.done;
    }
    if (all_done) {
      this.StartElection();
    }
  }

  StartCampaign() {
    this.state = States.campaign;
    this.year++;
    if (this.black !== undefined) {
      this.black_dealer.ReturnOne(this.black);
    }

    for (let player of this.players) {
      player.done = false;
    }

    this.black = this.black_dealer.DealOne();
    this.black_holes = Math.max(1,  (this.black.match(/_/g)||[]).length);
    console.log(`${this.black_holes} black holes!`);

    this.trump_idx = (this.trump_idx + 1).mod(this.players.length);
    this.trump = this.players[this.trump_idx];

    this.UpdateAllPlayersWithInfo();
  }

  StartElection() {
    this.state = States.election;
    this.RolloutCampaignAgenda();
    this.UpdateAllPlayersWithInfo();
  }

  StartWaiting() {
    this.state = States.waiting;
    this.UpdateAllPlayersWithInfo();
  }

  UpdateAllPlayersWithInfo() {
    for (let player of this.players) {
      this.UpdatePlayerWithInfo(player);
    }
  }

  UpdatePlayerWithInfo(player) {
    switch(this.state) {
      case States.campaign:
        this.SendCampaignInfo(player);
        break;
      case States.election:
        this.SendElectionInfo(player);
        break;
      default:
        this.SendWaitingInfo(player);
    }
  }

  SendElectionInfo(player) {
    this.SendJSON(player, {
      state: "election",
      black: this.black,
      election: this.election.map(x => x.cards),
      istrump: player === this.trump,
      trump: this.trump.name,
    })
  }

  SendCampaignInfo(player) {
    this.SendJSON(player, {
      state: "campaign",
      previous_election: this.last_election,
      black: this.black,
      year: this.year,
      hand: player === this.trump ? undefined : player.hand,
      istrump: player === this.trump,
      trump: this.trump.name,
    })
  }

  SendWaitingInfo(player) {
    this.SendJSON(player, {state: "waiting"});
  }

  SendJSON(player, json) {
    try {
      json = {
        your_score: player.score,
        recovery_code: player.recovery,
        msg: json
      }
      let msg = JSON.stringify(json);
      player.ws.send(msg);
    } catch {}
  }

  RemovePlayer(player) {
    for (let card of player.hand) this.white_dealer.ReturnOne(card);
    const idx = this.players.indexOf(player);
    this.players.splice(idx, 1);
    if (this.players.length === 0) {
      this.DeleteRoom();
    } else if (this.players.length === cMinPlayers - 1) {
      this.StartWaiting();
    } else if (idx === this.trump_idx) {
      this.trump_idx = (idx - 1).mod(this.players.length);
      this.trump = undefined;
      this.StartCampaign();
    } else {
      this.CheckAllDone();
    }
  }

  EndElection(winner) {
    winner = Math.floor(winner);
    if (winner < 0 || winner >= this.election.length) return;
    this.election[winner].player.score++;
    this.last_election = {
      trump: this.trump.name,
      trump_score: this.trump.score,
      black: this.black,
      candidates: this.election.map(x => {
        return {
          cards: x.cards,
          player: x.player.name,
          player_score: x.player.score,
          winner: false
        };
      })
    };
    this.last_election.candidates[winner].winner = true;
    this.StartCampaign();
  }

  RolloutCampaignAgenda() {
    this.election = []
    for (let player of this.players) {
      if (this.trump === player) continue;
      let cards = player.campaign.map(x => player.hand[x]);
      let set = new Set(player.campaign.concat(player.discard).map(x => player.hand[x]));
      player.hand = player.hand.filter(x => !set.has(x));
      for (let card of set) this.white_dealer.ReturnOne(card);
      while (player.hand.length < cCardsPerHand) player.hand.push(this.white_dealer.DealOne());
      this.election.push({
        player: player,
        cards: cards
      });
    }
  }

  RecoverPlayer(recovery_code) {
    for (let player of this.players) {
      if (player.recovery == recovery_code) {
        return player
      }
    }
    return false
  }
}

class Player {
  constructor(name, ws, room, score = 0) {
    this.name = name;
    this.ws = ws;
    this.hand = [];
    this.score = score;
    this.room = room;
    this.done = false;
    this.discard = undefined;
    this.campaign = undefined;

    this.recovery = UUID();
    this.left = false;
    this.timeout = undefined;
    
    this.room.AddPlayer(this);
    this.SetupWs();
  }

  SetupWs() {
    this.ws.on("message", (msg) => {
      if (msg === "ping") {
        try {
          this.ws.send("pong");
        } catch(e) {
          console.log(e);
        }
      } else try {
        this.Handle(JSON.parse(msg));
      } catch(e) {
        console.log(e);
      }
    });

    const close = () => {
      if (this.left) return;
      this.timeout = setTimeout(() => {
          this.Exit();
      }, cPlayerReconnectionTimeout);
    };
    this.ws.on("error", close);
    this.ws.on("close", close);
  }

  Recover(ws) {
    clearTimeout(this.timeout);
    this.ws = ws;
    this.SetupWs();
  }

  Exit() {
    console.log("Removing player");
    this.room.RemovePlayer(this);
    delete this.room;
    try {this.ws.close();} catch {};
  }

  Handle(msg) {
    const room = this.room;
    if (msg.leave) {
      console.log("Properly leaving");
      this.left = true;
      this.Exit();
      return;
    } else if (room.state == States.campaign) {
      if (room.trump !== this) {
        if (this.done === true) return;
        if (msg.year !== room.year) return;
        if (!Array.isArray(msg.discard) || !Array.isArray(msg.cards)) return;
        const set = new Set(msg.cards.concat(msg.discard));
        if (set.size !== msg.cards.length + msg.discard.length) return;
        if (msg.cards.length !== this.room.black_holes) return;
        for (let v of set) if (v !== Math.floor(v)) return;
        for (let v of set) if (v < 0 || v >= cCardsPerHand) return;
        this.discard = msg.discard;
        this.campaign = msg.cards;
        this.done = true;
        this.room.CheckAllDone();
      }
    } else if (room.state == States.election) {
      if (room.trump === this) {
        room.EndElection(msg.winner);
      }
    }
  }
}

const wss = new WebSocket.Server({ server: fserver });
const all_rooms = new Map();

wss.on('connection', function(ws, inm) {
  ws.on("message", function(msg) {
    try {
      jmsg = JSON.parse(msg);     
      if (typeof(jmsg.name) === "string"
        && typeof(jmsg.room) === "string") {
          let initial_score = 0;
          if (jmsg.score && typeof(jmsg.score) === "number") {
            initial_score = Math.floor(jmsg.score);
          }

          this.removeAllListeners();

          if (!all_rooms.has(jmsg.room)) {
            new Room(jmsg.room, all_rooms);
          }
          let room = all_rooms.get(jmsg.room);
          
          if (jmsg.recovery_code) {
            let player = room.RecoverPlayer(jmsg.recovery_code);
            if (player) {
              player.Recover(this);
              room.UpdatePlayerWithInfo(player);
            } else {
              new Player(jmsg.name, this, room, initial_score);    
            }
          } else {
            new Player(jmsg.name, this, room, initial_score);
          }
        }
    } catch(e) {
      console.log(e);
    }
  });

  ws.on("close", ()=>{
    console.log("Closing before entering room.");
  });

  ws.on("error", ()=>{
    console.log("Error before entering room.");
  });
});

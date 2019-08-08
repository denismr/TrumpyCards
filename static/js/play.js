
let player_name;
let room_name;
let player_score = 0;
let player_recovery_code = undefined;
let ws = undefined;
let cont = undefined;

setInterval(() => {
  if (ws === undefined) return;
  ws.send("ping");
}, 10000);

function NoticeDiv() {
  return $("<div>").addClass("notice");
}

function DisconnectListener() {
  if (ws === undefined) return;
  ws = undefined;
  console.log("Disconnected from the server.");
  let notice = NoticeDiv().append($("<p>").text("Disconnect from the server.")).appendTo(cont.empty());
  let btn = $("<button>").text("Reconnect").click(ConnectToServer).appendTo(cont);
}

function EnterRoom() {
  this.send(JSON.stringify({
    name: player_name,
    room: room_name,
    score: player_score,
    recovery_code: player_recovery_code
  }));
}

function BlackPar(txt) {
  let black_holes = Math.max(1,  (txt.match(/_/g)||[]).length)
  txt = txt.replace(/\n/g, "<br>") + " ";
  let segments = txt.split('_');
  let div = $("<div>").addClass("black_card");
  let card_content = $("<div>").addClass("card_content").appendTo(div);
  let p = $("<p>").addClass("black_paragraph").appendTo(card_content);
  let holes = [];
  for (let i = 0; i < segments.length; i++) {
    $("<span>").html(segments[i]).appendTo(p)
    if (holes.length < black_holes) {
      holes.push($("<span>").addClass("black_hole").appendTo(p));
    }
  }
  return [div, holes];
}

function ShowPreviousElection(msg) {
  cont.empty();
  let pe = msg.previous_election;
  $("<p>")
    .append($("<span>").addClass("pinfo_by").text(pe.trump))
    .append($("<span>").addClass("pinfo_score").text(pe.trump_score))
    .append($("<span>").text("was the previous Trump."))
    .appendTo(NoticeDiv().appendTo(cont));
  for (let cand of pe.candidates) {
    let cdiv = $("<div>").addClass('le_cand_div');
    if (cand.winner) cdiv.addClass('winner');
    let pinfo = $("<div>").addClass('pinfo_div');
    let [p, holes] = BlackPar(pe.black);
    cdiv.append(p).append(pinfo).appendTo(cont);

    $("<span>").addClass("pinfo_by_lbl").text("By").appendTo(pinfo);
    $("<span>").addClass("pinfo_by").text(cand.player).appendTo(pinfo);
    $("<span>").addClass("pinfo_score").text(cand.player_score).appendTo(pinfo);

    for (let i = 0; i < cand.cards.length; i++) {
      holes[i].text(cand.cards[i]);
    }
  }
  $("<button>").text("Proceed").appendTo(cont).click(() => {
    ShowCampaign(msg);
  });
}

function ListHand(hand) {
  let ul  = $("<ul>").appendTo(cont);
  let opts = [];
  let idx = 0;
  for (let txt of hand) {
    let li = $("<li>").appendTo(ul);
    let discard = $("<div>").addClass("del_card").text("Discard").appendTo(li);
    let card = $("<span>").text(txt).addClass("card_txt").appendTo(li);
    opts.push({idx, discard, card, li});
    idx++;
  }
  return opts;
}

function ShowCampaign(msg) {
  cont.empty();
  let [black_card, holes] = BlackPar(msg.black);
  cont.append(black_card);
  if (msg.istrump) {
    ShowCampaign_Trump(msg);
  } else {
    ShowCampaign_NotTrump(msg, holes);
  }
}

function ShowCampaign_Trump(msg) {
  cont.append(NoticeDiv().text("You are Trump, now! Wait for the voters."));
}

function ShowCampaign_NotTrump(msg, holes) {
  cont.append(NoticeDiv().text(`${msg.trump} is Trump, now! Make your campaign.`));
  let n = holes.length;
  let discard_set = new Set();
  let choices = new Array(n).fill(undefined);
  let cn = 0;
  let hand = ListHand(msg.hand);
  let btn = $("<button>").appendTo(cont);
  function UptBtn() {
    if (cn == n) {
      btn.prop("disabled", false);
      btn.text("GO!");
    } else {
      btn.prop("disabled", true);
      btn.text(`Select cards (${cn}/${n})`)
    }
  }
  UptBtn();
  for (let {idx, discard, card, li} of hand) {
    li.click(function() {
      if (choices.includes(idx)) {
        let h = choices.indexOf(idx);
        choices[h] = undefined;
        holes[h].empty();
        cn--;
        discard.show();
        li.removeClass("card_selected");
        UptBtn();
      } else if(cn < n && !discard_set.has(idx)) {
        cn++;
        let h = choices.indexOf(undefined);
        choices[h] = idx;
        holes[h].text(card.text());
        discard.hide();
        li.addClass("card_selected");
        UptBtn();
      } else if (discard_set.has(idx)) {
        discard_set.delete(idx);
        li.removeClass("card_discard");
        discard.show();
      }
    });
    discard.click(function(event) {
      discard.hide();
      discard_set.add(idx);
      li.addClass("card_discard");
      event.stopPropagation();
    });
  }
  btn.click(() => {
    cont.empty().append(NoticeDiv().text("Waiting for the other candidates."));
    ws.send(JSON.stringify({
      year: msg.year,
      discard: Array.from(discard_set),
      cards: choices
    }));
  });
}

function ShowElection(msg) {
  cont.empty();
  let plist = [];
  for (let cand of msg.election) {
    let [p, holes] = BlackPar(msg.black);
    cont.append(p);
    for (let i = 0; i < cand.length; i++) {
      holes[i].text(cand[i]);
    }
    plist.push(p);
  }
  if (!msg.istrump) {
    cont.append(NoticeDiv().append($("<p>").text(`Waiting for ${msg.trump} Trump to f* us all.`)));
  } else {
    cont.append(NoticeDiv().append($("<p>").text("You are Trump! Do your thing and choose the worst.")));
    for (let i = 0; i < plist.length; i++) {
      plist[i].click(() => {
        cont.empty();
        ws.send(JSON.stringify({winner: i}));
      });
    }
  }

}

let Handlers = {
  waiting() {
    cont.empty().append(NoticeDiv().append($("<p>").text("Waiting for more candidates to join.")));
  },
  campaign(msg) {
    if (msg.previous_election) ShowPreviousElection(msg);
    else ShowCampaign(msg);
  },
  election(msg) {
    ShowElection(msg);
  }
}

function HandleMsg({data: str_msg}) {
  if (str_msg=="pong") return;
  let msg;
  [{your_score: player_score = player_score,
    recovery_code: player_recovery_code = player_recovery_code,
    msg
  }] = [JSON.parse(str_msg)];
  console.log(msg);
  Handlers[msg.state](msg);
}

function ExtractParams() {
  let re = /([^?&=]+)=([^?&=]+)/g;
  let ret = {};
  for (let x; x = re.exec(window.location.search);) {
    ret[x[1]] = x[2];
  }
  return ret;
}

function ConnectToServer() {
  NoticeDiv().append($("<p>").text("Connecting.")).appendTo(cont.empty());
  const bar = window.location.href;
  const wsAddress = location.origin.replace(/^http/, 'ws')
  try {
    ws = new WebSocket(wsAddress);
    ws.addEventListener("close", DisconnectListener);
    ws.addEventListener("error", DisconnectListener);
    ws.addEventListener("open", EnterRoom);
    ws.addEventListener("message", HandleMsg);
  } catch {
    console.log("Could not connect to the server.");
  }
}

function Quit() {
  if (ws) {
    ws.send(JSON.stringify({leave: true}));
    ws = undefined;
  }
}

$(window).on("pagehide", Quit);
$(window).on("beforeunload", Quit);

$(document).ready(function() {
  cont = $('#maincontainer');
  [{
    user: player_name = "Bob",
    room: room_name = "Most Public Room"
  }] = [ExtractParams()];
  ConnectToServer();
});
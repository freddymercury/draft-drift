import { buildBoard } from "./board";
import { readSources } from "./sources";
import { loadState, saveState, picksUntilNextTurn, rosterNeed } from "./state";
import { recommend } from "./recommend";
import { analyzeQueue } from "./queue";
import { deriveLeagueFromMarkers, detectPick } from "./yahoo";
import { diffDrafted } from "./events";
import type { Opts } from "./options";
import type { Board } from "./types";

const PORT = 8766;

async function snapshot(opts: Opts, board: Board) {
  const src = await readSources(board.players);
  const state = await loadState(opts.statePath);

  if (src.filtered) return { filtered: true, reason: src.filterReason, state, recs: [], src, wait: 0, mine: [] };

  if (src.roster?.players.length) {
    state.myPicks = src.roster.players.map((p) => p.name);
    for (const p of src.roster.players) {
      if (!state.drafted.includes(p.name)) state.drafted.push(p.name);
    }
  }
  if (src.pool) {
    const derived = deriveLeagueFromMarkers(src.pool.text);
    if (derived) {
      board.config.teams = derived.teams;
      board.config.my_draft_slot = derived.slot;
    }
    const det = detectPick(src.pool.title, src.pool.text, board.config.teams, board.config.my_draft_slot);
    if (det) state.currentPick = det.pick;
    const prev = board.players.filter((p) => (state.lastSeen ?? []).includes(p.name));
    const { drafted } = diffDrafted(prev.length ? prev : null, src.pool.players);
    for (const p of drafted) if (!state.drafted.includes(p.name)) state.drafted.push(p.name);
    state.lastSeen = src.pool.players.map((p) => p.name);
  }
  await saveState(opts.statePath, state);

  const avail = (src.pool?.players ?? []).filter((p) => !state.drafted.includes(p.name));
  const mine = board.players.filter((p) => state.myPicks.includes(p.name));
  const queueNames = (src.queue?.players ?? []).map((p) => p.name);
  const queueAnalysis = queueNames.length
    ? analyzeQueue(board, state, avail, queueNames, picksUntilNextTurn(board.config, state.currentPick))
    : null;

  return {
    filtered: false,
    state,
    src,
    mine,
    queueAnalysis,
    wait: picksUntilNextTurn(board.config, state.currentPick),
    recs: recommend(board, state, avail, 8),
    need: rosterNeed(board.config, mine).open,
  };
}

const PAGE = `<!doctype html><meta charset=utf-8><title>draft-drift</title>
<style>
 body{background:#12141a;color:#ECEAE4;font:14px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;margin:0;padding:14px}
 h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7B8091;margin:14px 0 6px}
 .turn{background:#4FD8C4;color:#12141A;font-weight:700;padding:8px 10px;border-radius:6px;margin-bottom:10px}
 .soon{background:#F5A623;color:#12141A}
 .r{display:flex;gap:8px;padding:7px 9px;border:1px solid #282D3A;border-radius:6px;margin-bottom:5px;background:#1E212C}
 .r .n{font-weight:600;flex:1}
 .r .m{color:#7B8091;font-size:11.5px;font-family:monospace}
 .r.top{border-color:#4FD8C4}
 .why{color:#7B8091;font-size:11px;padding:0 9px 6px}
 .slot{display:flex;gap:8px;font-size:12.5px;padding:2px 0}
 .slot .k{width:44px;color:#7B8091;font-family:monospace}
 .ok{color:#4FD8C4}.warn{color:#F5A623}
 #meta{color:#7B8091;font-size:10.5px;font-family:monospace;margin-top:12px}
 .q{display:flex;gap:8px;align-items:baseline;padding:4px 9px;border-left:2px solid #282D3A;margin-bottom:3px}
 .q .i{color:#7B8091;font-family:monospace;font-size:11px;width:14px}
 .q .n{flex:1}
 .q .s{font-family:monospace;font-size:11px;color:#7B8091}
 .q.risk{border-left-color:#F5A623}
 .q.risk .s{color:#F5A623}
 .note{padding:8px 10px;border-radius:6px;margin-bottom:6px;background:#1E212C;border:1px solid #282D3A}
 .note.reorder{border-color:#F5A623}
 .note.warning{border-color:#E5484D}
 .note h4{margin:0 0 4px;font-size:12.5px;font-weight:600}
 .note.reorder h4{color:#F5A623}
 .note.warning h4{color:#E5484D}
 .note p{margin:0;font-size:11.5px;color:#B9BDC9;line-height:1.45}
 .ok{color:#4FD8C4;font-size:11.5px;padding:2px 9px}
 .sbs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
 .sbs h3{margin:0 0 6px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#7B8091;font-weight:600}
 .cell{display:flex;gap:6px;align-items:baseline;padding:5px 7px;border-radius:5px;margin-bottom:3px;background:#1E212C;border:1px solid #282D3A;font-size:11.5px}
 .cell .i{color:#7B8091;font-family:monospace;font-size:10px;width:11px;flex-shrink:0}
 .cell .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .cell .m{font-family:monospace;font-size:9.5px;color:#7B8091;flex-shrink:0}
 .cell.both{border-color:#4FD8C4}
 .cell.only{border-color:#F5A623}
 .cell.only .m{color:#F5A623}
 .legend{font-size:9.5px;color:#7B8091;margin:4px 0 2px;font-family:monospace}
</style><body><div id=app>loading…</div><script>
async function tick(){
 try{
  const d=await (await fetch('/api')).json();
  const e=document.getElementById('app');
  if(d.filtered){e.innerHTML='<div class="turn soon">'+(d.reason||'list is filtered')+' &mdash; click All Positions / clear search</div>';return}
  let h='';
  if(d.wait===0)h+='<div class="turn">YOUR PICK — ON THE CLOCK</div>';
  else if(d.wait<=3)h+='<div class="turn soon">'+d.wait+' pick'+(d.wait==1?'':'s')+' until your turn</div>';
  h+='<h2>Pick '+d.pick+' &middot; round '+d.round+(d.wait?' &middot; '+d.wait+' until yours':'')+'</h2>';
  d.recs.forEach((r,i)=>{
   h+='<div class="r'+(i==0?' top':'')+'"><span class="n">'+(i+1)+'. '+r.name+'</span><span class="m">'+r.pos+' &middot; VOR '+r.vor+' &middot; T'+r.tier+'</span></div>';
   h+='<div class="why">'+r.why+'</div>';
  });
  if(d.queue){
   const qn=d.queue.rows.map(r=>r.name);
   const bn=d.recs.map(r=>r.name);
   h+='<h2>Queue vs board'+(d.queue.orderMatches?' &middot; order matches':'')+'</h2>';
   h+='<div class="sbs"><div><h3>your queue</h3>';
   d.queue.rows.forEach((r,i)=>{
    const inBoth=bn.includes(r.name);
    h+='<div class="cell'+(inBoth?' both':'')+'"><span class="i">'+(i+1)+'</span>'+
       '<span class="n">'+r.name+'</span>'+
       '<span class="m">'+Math.round(r.survival*100)+'%</span></div>';
   });
   h+='</div><div><h3>board says</h3>';
   d.recs.slice(0,Math.max(d.queue.rows.length,5)).forEach((r,i)=>{
    const queued=qn.includes(r.name);
    h+='<div class="cell'+(queued?' both':' only')+'"><span class="i">'+(i+1)+'</span>'+
       '<span class="n">'+r.name+'</span>'+
       '<span class="m">'+(queued?r.vor:'not queued')+'</span></div>';
   });
   h+='</div></div>';
   h+='<div class="legend">teal = in both &middot; amber = board wants it, you have not queued it &middot; % = odds of lasting</div>';
   d.queue.notes.forEach(n=>{
    h+='<div class="note '+n.kind+'"><h4>'+n.headline+'</h4><p>'+n.because+'</p></div>';
   });
  }
  h+='<h2>Roster</h2>';
  for(const s of d.roster)h+='<div class="slot"><span class="k '+(s.full?'ok':'warn')+'">'+s.pos+' '+s.have+'/'+s.want+'</span><span>'+s.names+'</span></div>';
  h+='<div id=meta>need: '+d.need+' &middot; pool '+d.pool+' &middot; capture '+d.age+'s old</div>';
  e.innerHTML=h;
 }catch(err){}
}
tick();setInterval(tick,3000);
</script>`;

export async function serve(opts: Opts): Promise<void> {
  const board = await buildBoard(opts);
  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api") {
        const s = await snapshot(opts, board);
        if (s.filtered) return Response.json({ filtered: true, reason: s.reason });
        const cfg = board.config;
        const age = s.src.pool
          ? Math.round((Date.now() - Date.parse(s.src.pool.capturedAt)) / 1000)
          : -1;
        return Response.json({
          filtered: false,
          pick: s.state.currentPick,
          round: Math.ceil(s.state.currentPick / cfg.teams),
          wait: s.wait,
          age,
          pool: s.src.pool?.players.length ?? 0,
          need: Object.entries(s.need ?? {}).filter(([, v]) => v && v > 0).map(([k, v]) => `${k}x${v}`).join(", ") || "complete",
          queue: s.queueAnalysis
            ? {
                orderMatches: s.queueAnalysis.orderMatches,
                rows: s.queueAnalysis.queue,
                notes: s.queueAnalysis.notes,
              }
            : null,
          recs: s.recs.map((r) => ({
            name: r.player.name,
            pos: `${r.player.pos}${r.player.posRank} ${r.player.team ?? ""}`,
            vor: r.player.vor,
            tier: r.player.tier,
            why: r.reasons.join(" · "),
          })),
          roster: (["QB", "RB", "WR", "TE", "K", "DEF"] as const).map((pos) => {
            const have = s.mine.filter((p) => p.pos === pos);
            const want = cfg.roster[pos] ?? 0;
            return { pos, have: have.length, want, full: have.length >= want, names: have.map((p) => p.name).join(", ") || "—" };
          }),
        });
      }
      return new Response(PAGE, { headers: { "Content-Type": "text/html" } });
    },
  });
  console.log(`draft-drift UI -> http://localhost:${PORT}  (refreshes every 3s)`);
}

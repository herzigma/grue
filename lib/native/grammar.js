// Grammar table. Pattern mini-language (space separated):
//   word|word  literal alternatives      N  direct noun phrase     M  second noun phrase
//   T  free text                         D  compass direction
// Entry: [pattern, action, extras]. extras are copied onto the action ({prep, dir}).

export const DIR_WORDS = Object.assign(Object.create(null), {
  n: 'n', north: 'n', s: 's', south: 's', e: 'e', east: 'e', w: 'w', west: 'w',
  ne: 'ne', northeast: 'ne', nw: 'nw', northwest: 'nw', se: 'se', southeast: 'se', sw: 'sw', southwest: 'sw',
  u: 'u', up: 'u', d: 'd', down: 'd', in: 'in', inside: 'in', out: 'out', outside: 'out',
});

const IN = { prep: 'in' };
const ON = { prep: 'on' };

const RAW = [
  ['look|l', 'look'],
  ['look|l around|about|here', 'look'],
  ['search|explore', 'look'],
  ['examine|x|inspect|check|study|observe|view|describe|watch N', 'examine'],
  ['look|l|peer|gaze|glance at N', 'examine'],
  ['look|l under|beneath|underneath N', 'lookunder'],
  ['look|l behind N', 'lookbehind'],
  ['look|l|peer|search|check in|inside|into|through N', 'search'],
  ['search|rummage|ransack N', 'search'],
  ['read|peruse|skim N', 'read'],
  ['inventory|inv|i|items|possessions', 'inventory'],

  ['take|get|grab|carry|hold|acquire|seize|steal|snatch|lift|raise|collect|fetch N', 'take'],
  ['pick up N', 'take'],
  ['pick N up', 'take'],
  ['take|get|grab|remove|retrieve|fetch|lift N from|off|outof|out M', 'take'],
  ['take off N', 'remove'],
  ['take N off', 'remove'],
  ['remove|doff N', 'remove'],
  ['wear|don N', 'wear'],
  ['put on N', 'wear'],
  ['put N on', 'wear'],
  ['drop|discard|dump|release|abandon N', 'drop'],
  ['put|set|place|lay|leave down N', 'drop'],
  ['put|set|place|lay N down', 'drop'],
  ['put|place|insert|stick|stuff|drop|slip|store N in|into|inside M', 'put', IN],
  ['put|place|set|lay|hang|stick|rest|lean|prop N on|onto|upon|over|against M', 'put', ON],
  ['put|place|insert|stick|stuff N', 'put'],
  ['give|offer|hand|feed|pay|present N to M', 'give'],
  ['give|offer|hand|feed|pay|present N', 'give'],
  ['show|display|present N to M', 'show'],
  ['show|display N', 'show'],

  ['open|unwrap|uncover N', 'open'],
  ['open N with|using M', 'open'],
  ['pry|force|jimmy|prise|prize N with|using M', 'open'],
  ['pry|force|jimmy|prise|prize N', 'open'],
  ['pry|force|jimmy|prise|prize open N', 'open'],
  ['pry|force|jimmy|prise|prize open N with|using M', 'open'],
  ['close|shut N', 'close'],
  ['unlock N with|using M', 'unlock'],
  ['unlock N', 'unlock'],
  ['lock N with|using M', 'lock'],
  ['lock N', 'lock'],

  ['turn|switch|flip|power on N', 'switchon'],
  ['turn|switch|flip|power N on', 'switchon'],
  ['activate|start|enable|ignite N', 'switchon'],
  ['turn|switch|flip|power off N', 'switchoff'],
  ['turn|switch|flip|power N off', 'switchoff'],
  ['extinguish|douse|snuff|quench|deactivate|disable|stop N', 'switchoff'],
  ['put out N', 'switchoff'],
  ['blow out N', 'switchoff'],
  ['light|kindle N with|using M', 'light'],
  ['light|kindle N', 'light'],
  ['flip|toggle N', 'toggle'],

  ['push|press|shove|move|shift|slide|nudge|poke|prod N', 'push'],
  ['pull|drag|tug|yank|haul N', 'pull'],
  ['turn|rotate|twist|spin|crank|wind|screw N', 'turn'],
  ['turn|rotate|twist|spin|set|adjust|dial|tune|move|push N to|at|on|onto|toward|towards T', 'turn'],
  ['set N to|at|on T', 'turn'],
  ['set|dial|tune|spin N', 'turn'],

  ['type|input|punch|dial|key|enter|tap|say|spell T on|in|into|at|to M', 'type'],
  ['enter|board N', 'enter'],
  ['go|walk|run|head|climb|get|step in|into|inside|through N', 'enter'],
  ['sit|lie|stand|climb|get on|onto|upon N', 'enter'],
  ['type|input|punch|dial|enter|key T', 'type'],
  ['enter|inside', 'go', { dir: 'in' }],
  ['leave|exit|depart|outside', 'go', { dir: 'out' }],
  ['get|go|step|climb out|outof', 'go', { dir: 'out' }],
  ['get|go|step|climb in', 'go', { dir: 'in' }],
  ['climb|scale|ascend|clamber N', 'climb'],
  ['climb|scale|ascend|clamber up|over|onto N', 'climb'],
  ['climb|ascend|clamber up', 'go', { dir: 'u' }],
  ['climb|descend|clamber|get|step down', 'go', { dir: 'd' }],
  ['get|step up', 'go', { dir: 'u' }],
  ['go|walk|run|head|travel|proceed|move|crawl|hike D', 'go'],
  ['D', 'go'],

  ['wait|z|rest|stay|pause', 'wait'],
  ['again|g', 'again'],
  ['score|points', 'score'],
  ['help|?|instructions', 'help'],
  ['hint|hints|clue', 'hint'],
  ['about|info|credits|version|author|license|licence', 'about'],
  ['undo', 'undo'],
  ['save', 'save'],
  ['restore|load', 'restore'],
  ['restart', 'restart'],
  ['quit|q', 'quit'],

  ['eat|consume|devour|swallow|bite|taste N', 'eat'],
  ['drink|sip|quaff|gulp N', 'drink'],
  ['drink from N', 'drink'],
  ['ask N about|regarding|on T', 'ask'],
  ['ask N for T', 'ask'],
  ['ask|question|interview N', 'talk'],
  ['tell|inform|brief N about|of|on T', 'tell'],
  ['talk|speak|chat|converse to|with N about T', 'ask'],
  ['talk|speak|chat|converse to|with N', 'talk'],
  ['greet|hail|salute|hello|hi|hey N', 'talk'],
  ['hello|hi|hey|greetings', 'hello'],
  ['say|shout|yell|whisper|scream|call|speak T to N', 'say'],
  ['say|shout|yell|whisper|scream|call|speak|answer|reply T', 'say'],
  ['attack|hit|kick|punch|fight|kill|strike|smash|break|destroy|bash|slap|stab|slay|murder|wreck N with|using M', 'attack'],
  ['attack|hit|kick|punch|fight|kill|strike|smash|break|destroy|bash|slap|stab|slay|murder|wreck N', 'attack'],
  ['listen|hear', 'listen'],
  ['listen|hear to N', 'listen'],
  ['smell|sniff', 'smell'],
  ['smell|sniff N', 'smell'],
  ['touch|feel|pat|stroke|pet|squeeze|tap|hug|kiss|embrace N', 'touch'],
  ['rub|polish|clean|wipe|scrub|dust N', 'rub'],
  ['knock on|at N', 'knock'],
  ['knock', 'knock'],
  ['jump|hop|leap|skip', 'jump'],
  ['sing|hum|whistle|yodel|dance', 'sing'],
  ['sleep|nap|doze', 'sleep'],
  ['wake|awake|wake up', 'wake'],
  ['swim|dive|wade|splash', 'swim'],
  ['swim|dive|wade in|into|through|across N', 'swim'],
  ['xyzzy|plugh|abracadabra|shazam|alakazam', 'xyzzy'],
  ['yes|no|maybe', 'yesno'],
  ['fill|load|top N with|from M', 'fill'],
  ['fill|load|top N', 'fill'],
  ['pour|tip|empty|spill|splash N in|into|on|onto|over M', 'pour'],
  ['pour|tip|empty|spill N', 'pour'],
  ['pour|tip|empty|spill N out|away', 'pour'],
  ['cut|slice|chop|saw|snip|slash N with|using M', 'cut'],
  ['cut|slice|chop|saw|snip|slash N', 'cut'],
  ['tie|attach|fasten|bind|connect|hook N to|on|onto|with M', 'tie'],
  ['fit|mount|install|slot N to|on|onto|in|into M', 'tie'],
  ['oil|grease|lubricate|lube N with|using M', 'oil'],
  ['oil|grease|lubricate|lube N', 'oil'],
  ['untie|detach|unfasten|disconnect|unscrew|unhook N', 'untie'],
  ['dig|excavate N with|using M', 'dig'],
  ['dig|excavate N', 'dig'],
  ['dig', 'dig'],
  ['throw|toss|hurl|fling|chuck N at|to|into|toward|towards M', 'throw'],
  ['throw|toss|hurl|fling|chuck N', 'throw'],
  ['wave|brandish|swing|flourish N', 'wave'],
  ['shake|rattle N', 'shake'],
  ['burn|incinerate|torch N with|using M', 'burn'],
  ['burn|incinerate|torch N', 'burn'],
  ['use|utilise|utilize|employ|apply N on|with|in|to|onto|against M', 'use'],
  ['use|utilise|utilize|employ|apply N', 'use'],
  ['think|ponder|pray|curse|swear|cry', 'think'],
];

function compile([src, action, extras]) {
  const els = src.split(' ').map((tok) => {
    if (tok === 'N') return { slot: 'noun' };
    if (tok === 'M') return { slot: 'second' };
    if (tok === 'T') return { slot: 'text' };
    if (tok === 'D') return { slot: 'dir' };
    return { lit: tok.split('|') };
  });
  return { src, action, extras: extras ?? {}, els, litCount: els.filter((e) => e.lit).length };
}

export const GRAMMAR = RAW.map(compile);

/** Words that can begin a command (used to tell a fresh command from an answer). */
export const VERB_WORDS = new Set();
for (const p of GRAMMAR) if (p.els[0].lit) for (const w of p.els[0].lit) VERB_WORDS.add(w);
for (const w of Object.keys(DIR_WORDS)) VERB_WORDS.add(w);

/** The agent-orchestration diagram: a node-flow of the debate graph, live-lit as
 *  the swarm runs. Topology is DERIVED from SPECIALISTS + the fixed red-team →
 *  judge → verdict tail, so it tracks the langgraph layout rather than hard-coding
 *  it — change the specialist set and this picture follows. (Graph: specialists
 *  fan into red-team, which fans to per-specialist rebuttals, then judge → verdict.) */

import { AGENT_COLOR, AGENT_NAME } from './components'
import type { DebateState } from './reducer'
import { SPECIALISTS, type AgentName } from './types'

type NodeStatus = 'idle' | 'active' | 'done'

// active = mid-turn (full glow + breathing halo); done = spoke; idle = dim
function nodeVisual(status: NodeStatus) {
  return {
    fill: status === 'active' ? 1 : status === 'done' ? 0.82 : 0.16,
    halo: status === 'active' ? 0.9 : 0,
  }
}

const laneStatus = (s: 'idle' | 'thinking' | 'spoke'): NodeStatus =>
  s === 'thinking' ? 'active' : s === 'spoke' ? 'done' : 'idle'

const VERDICT_GLYPH: Record<string, string> = { bull: '▲', bear: '▼', neutral: '◈', no_call: '∅' }

export function Orchestration({ state }: { state: DebateState }) {
  const running = state.phase === 'streaming'

  // one column of specialist nodes, centered around y=116 so the picture stays
  // balanced whatever the specialist count is
  const gap = 70
  const colX = 160
  const startY = 116 - ((SPECIALISTS.length - 1) * gap) / 2
  const specialists = SPECIALISTS.map((agent, i) => ({
    agent,
    x: colX,
    y: startY + i * gap,
    status: laneStatus(state.lanes[agent].status),
  }))

  const redStatus = laneStatus(state.redTeam.status)
  const judgeStatus: NodeStatus = state.verdict ? 'done' : state.judgeActive ? 'active' : 'idle'
  const verdStatus: NodeStatus = state.verdict ? 'done' : 'idle'

  const verdColor = state.verdict
    ? { bull: 'var(--color-bull)', bear: 'var(--color-bear)', neutral: 'var(--color-neutralpole)', no_call: 'var(--color-ink-3)' }[state.verdict.direction]
    : 'var(--color-judge)'
  const verdGlyph = state.verdict ? VERDICT_GLYPH[state.verdict.direction] : '✦'

  const legend: AgentName[] = [...SPECIALISTS, 'red_team', 'judge']

  return (
    <div className="rounded-2xl border border-hairline p-[18px_20px_14px]"
         style={{ background: 'linear-gradient(180deg,#1a1d24,#171a20)' }}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2.5">
        <span className="font-display text-[16px] italic text-ink-2">Agent Orchestration</span>
        <div className="flex flex-wrap gap-3">
          {legend.map((a) => (
            <span key={a} className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-3">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: AGENT_COLOR[a] }} />
              {AGENT_NAME[a]}
            </span>
          ))}
        </div>
      </div>

      <svg viewBox="0 0 840 232" className="block h-auto w-full font-sans">
        {/* static rails */}
        <g stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" fill="none">
          {specialists.map((n) => <line key={n.agent} x1={n.x} y1={n.y} x2="400" y2="116" />)}
          <line x1="400" y1="116" x2="610" y2="116" />
          <line x1="610" y1="116" x2="770" y2="116" />
        </g>

        {/* flowing edges while the swarm is live */}
        <g fill="none" strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round" opacity={running ? 0.55 : 0}>
          {specialists.map((n) => (
            <line key={n.agent} className="flow-dash" x1={n.x} y1={n.y} x2="400" y2="116" stroke={AGENT_COLOR[n.agent]} />
          ))}
          <line className="flow-dash" x1="400" y1="116" x2="610" y2="116" stroke="var(--color-redteam)" />
          <line className="flow-dash" x1="610" y1="116" x2="770" y2="116" stroke="var(--color-judge)" />
        </g>

        <g textAnchor="middle">
          {specialists.map((n) => {
            const v = nodeVisual(n.status)
            const color = AGENT_COLOR[n.agent]
            // dim (idle) node: the fill is nearly transparent, so a dark glyph vanishes —
            // use the agent color instead; on a lit fill the dark glyph reads fine
            const letterFill = n.status === 'idle' ? color : '#14161b'
            return (
              <g key={n.agent}>
                <circle className={n.status === 'active' ? 'halo' : undefined} cx={n.x} cy={n.y} r="33" fill="none" stroke={color} strokeWidth="1.5" opacity={v.halo} />
                <circle cx={n.x} cy={n.y} r="24" fill={color} fillOpacity={v.fill} stroke={color} strokeOpacity="0.9" strokeWidth="1.6" />
                <text x={n.x} y={n.y + 6} fontSize="17" fontWeight="600" fill={letterFill}>{AGENT_NAME[n.agent][0]}</text>
                <text x={n.x - 50} y={n.y + 4} textAnchor="end" fontSize="12" fill="var(--color-ink-2)">{AGENT_NAME[n.agent]}</text>
              </g>
            )
          })}

          <FlowNode cx={400} label="Red-Team" glyph="R" color="var(--color-redteam)" status={redStatus} r={26} />
          <FlowNode cx={610} label="Judge" glyph="J" color="var(--color-judge)" status={judgeStatus} r={26} />
          <FlowNode cx={770} label="Verdict" glyph={verdGlyph} color={verdColor} status={verdStatus} r={24} />
        </g>
      </svg>
    </div>
  )
}

function FlowNode({ cx, label, glyph, color, status, r }: {
  cx: number; label: string; glyph: string; color: string; status: NodeStatus; r: number
}) {
  const v = nodeVisual(status)
  const letterFill = status === 'idle' ? color : '#14161b'
  return (
    <g>
      <circle className={status === 'active' ? 'halo' : undefined} cx={cx} cy={116} r={r + 9} fill="none" stroke={color} strokeWidth="1.5" opacity={v.halo} />
      <circle cx={cx} cy={116} r={r} fill={color} fillOpacity={v.fill} stroke={color} strokeOpacity="0.9" strokeWidth="1.6" />
      <text x={cx} y={122} fontSize={r >= 26 ? 18 : 17} fontWeight="600" fill={letterFill}>{glyph}</text>
      <text x={cx} y="164" fontSize="12" fill="var(--color-ink-2)">{label}</text>
    </g>
  )
}

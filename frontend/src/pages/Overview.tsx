import { AlertTriangle, Cpu, Radio, ShieldCheck } from 'lucide-react'
import { useMonitor } from '../hooks/useMonitor'
import { HumidityCard, TemperatureGauge } from '../components/Gauges'
import { LiveChart } from '../components/LiveChart'
import { SimulationPanel } from '../components/SimulationPanel'
import { AlertTable } from '../components/AlertTable'
import { Card, Stat } from '../components/ui'
import type { PageId } from '../types'

export default function Overview({ go }: { go: (p: PageId) => void }) {
  const { nodes, focusNode, settings, live, alerts, system, security } = useMonitor()
  const node = focusNode ? nodes[focusNode] : undefined
  const hum = (focusNode ? live[focusNode] ?? [] : []).map((r) => ({ t: r.received_at, h: r.humidity }))
  const all = Object.values(nodes)
  const online = all.filter((n) => n.online).length
  const recent = Object.values(alerts).sort((a, b) => b.triggered_at - a.triggered_at).slice(0, 6)
  const active = Object.values(alerts).filter((a) => !a.resolved_at)

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="xl:col-span-4"><TemperatureGauge node={node} settings={settings} /></div>
      <div className="flex flex-col gap-4 xl:col-span-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="!p-0"><div onClick={() => go('devices')} className="cursor-pointer p-1"><Stat label="Devices online" value={`${online}/${all.length}`} tone={online ? 'green' : 'slate'} hint={<span className="flex items-center gap-1"><Cpu size={11} />heartbeat based</span>} /></div></Card>
          <Card className="!p-0"><div onClick={() => go('emergency')} className="cursor-pointer p-1"><Stat label="Active alerts" value={active.length} tone={active.some((a) => a.severity === 'critical') ? 'red' : active.length ? 'amber' : 'green'} hint={<span className="flex items-center gap-1"><AlertTriangle size={11} />env + connectivity</span>} /></div></Card>
          <Card className="!p-0"><div onClick={() => go('network')} className="cursor-pointer p-1"><Stat label="MQTT broker" value={system?.mqtt.connected ? 'Connected' : system?.mqtt.enabled === false ? 'Disabled' : 'Down'} tone={system?.mqtt.connected ? 'green' : 'red'} hint={<span className="flex items-center gap-1"><Radio size={11} />{system?.mqtt.broker_rtt_ms_avg != null ? `${system.mqtt.broker_rtt_ms_avg} ms RTT` : 'RTT n/a'}</span>} /></div></Card>
          <Card className="!p-0"><div onClick={() => go('security')} className="cursor-pointer p-1"><Stat label="Threats blocked" value={security?.blocked ?? 0} tone={security?.blocked ? 'amber' : 'green'} hint={<span className="flex items-center gap-1"><ShieldCheck size={11} />{security?.inspected ?? 0} msgs inspected</span>} /></div></Card>
        </div>
        <HumidityCard node={node} history={hum} />
      </div>
      <div className="xl:col-span-8"><LiveChart node={focusNode} /></div>
      <div className="xl:col-span-4"><SimulationPanel /></div>
      <div className="xl:col-span-12">
        <Card title="Recent alerts" action={<button onClick={() => go('history')} className="text-xs text-tele hover:underline">Full history →</button>}>
          <AlertTable alerts={recent} empty="No alerts since this dashboard opened" />
        </Card>
      </div>
    </div>
  )
}

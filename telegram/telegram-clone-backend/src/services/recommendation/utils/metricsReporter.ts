import dgram from 'dgram';
import { PipelineMetrics } from '../framework/interfaces';

const STATSD_HOST = process.env.METRICS_STATSD_HOST;
const STATSD_PORT = process.env.METRICS_STATSD_PORT
    ? parseInt(process.env.METRICS_STATSD_PORT, 10)
    : undefined;

let socket: dgram.Socket | null = null;

function getSocket(): dgram.Socket | null {
    if (!STATSD_HOST || !STATSD_PORT) return null;
    if (!socket) {
        socket = dgram.createSocket('udp4');
    }
    return socket;
}

function send(metric: string) {
    const sock = getSocket();
    if (!sock) return;
    const msg = Buffer.from(metric);
    sock.send(msg, 0, msg.length, STATSD_PORT!, STATSD_HOST);
}

export function reportPipelineMetrics(prefix: string, metrics: PipelineMetrics) {
    if (!STATSD_HOST || !STATSD_PORT) return;
    const p = prefix ? `${prefix}.` : '';
    const { timing, counts, components } = metrics;
    send(`${p}retrieved:${counts.retrieved}|g`);
    send(`${p}filtered:${counts.filtered}|g`);
    send(`${p}post_filtered:${counts.postFiltered}|g`);
    send(`${p}selected:${counts.selected}|g`);
    send(`${p}timing.total:${timing.total}|ms`);
    send(`${p}timing.sourcing:${timing.sourcing}|ms`);
    send(`${p}timing.hydrating:${timing.hydrating}|ms`);
    send(`${p}timing.filtering:${timing.filtering}|ms`);
    send(`${p}timing.scoring:${timing.scoring}|ms`);
    send(`${p}timing.selecting:${timing.selecting}|ms`);
    if (typeof (timing as any).postSelectionHydrating === 'number') {
        send(`${p}timing.post_selection_hydrating:${(timing as any).postSelectionHydrating}|ms`);
    }
    if (typeof (timing as any).postSelectionFiltering === 'number') {
        send(`${p}timing.post_selection_filtering:${(timing as any).postSelectionFiltering}|ms`);
    }
    if (typeof (counts as any).postSelectionFiltered === 'number') {
        send(`${p}post_selection_filtered:${(counts as any).postSelectionFiltered}|g`);
    }

    if (components) {
        components.forEach((c) => {
            const base = `${p}component.${c.stage}.${c.name}`;
            send(`${base}.duration:${c.durationMs}|ms`);
            if (c.error) send(`${base}.error:1|c`);
            if (c.timedOut) send(`${base}.timeout:1|c`);
        });
    }
}

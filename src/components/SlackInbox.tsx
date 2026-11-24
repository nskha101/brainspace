import { useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AtSign, Inbox, MessageSquare } from 'lucide-react'
import { slackInboxConnectFn, slackInboxCreateBotFn, slackInboxDisconnectFn, slackInboxUpdateFn } from '../lib/api'
import { Badge, Button, Select } from './ui'
import { cn, errMessage, timeAgo } from '../lib/utils'

export type SlackInboxData = {
  slackConnected: boolean
  slackWorkspace: string | null
  serverReady: boolean
  connected: boolean
  botId: string | null
  dms: boolean
  mentions: boolean
  enabled: boolean
  lastEventAt: number | null
  bots: { id: string; name: string }[]
  canSetUp: boolean
}

function Toggle({ on, onChange, icon, label, hint }: { on: boolean; onChange: (v: boolean) => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn('flex flex-1 items-start gap-2.5 rounded-lg border p-3 text-left', on ? 'border-ink bg-paper' : 'border-line hover:border-line-2')}
    >
      <span className={cn('mt-0.5 [&>svg]:size-4', on ? 'text-ink' : 'text-ink-3')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{label}</span>
        <span className="block text-[12.5px] text-ink-3">{hint}</span>
      </span>
      <span className={cn('mt-0.5 text-[12px] font-medium', on ? 'text-ok' : 'text-ink-3')}>{on ? 'On' : 'Off'}</span>
    </button>
  )
}

/**
 * A person's Slack inbox: connect their own Slack account, choose which of
 * their bots gets the DMs and @mentions they receive, and switch each kind on or off.
 */
export function SlackInbox({ data }: { data: SlackInboxData }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  // Slack sends the person back here with the outcome in the address.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const err = q.get('slackError')
    if (err) toast.error(err)
    else if (q.get('slackConnected')) toast.success('Slack connected. Pick the bot that gets your messages.')
    if (err || q.get('slackConnected')) window.history.replaceState(null, '', `${window.location.pathname}#slack-inbox`)
  }, [])

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try {
      await fn()
      if (ok) toast.success(ok)
      await router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const connect = () =>
    act('connect', async () => {
      const r = await slackInboxConnectFn()
      window.location.href = r.url
    })

  return (
    <section id="slack-inbox" className="mt-10 scroll-mt-6 border-t border-line pt-8">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <Inbox className="size-4" /> Slack inbox
        {data.connected && data.slackConnected && data.serverReady && (data.enabled && data.botId ? <Badge tone="ok">On</Badge> : <Badge>{data.botId ? 'Paused' : 'Needs a bot'}</Badge>)}
      </h2>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        Have one of your bots woken when someone DMs you or @mentions you in Slack. It gets the message and the conversation around it, reads Slack as you, and
        can DM you a draft reply. It never answers anyone for you.
      </p>

      {!data.slackConnected ? (
        <p className="mt-4 rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-2">
          This workspace hasn't added Slack yet.{' '}
          <Link to="/app/connections" className="font-medium underline">
            Add it under Connections
          </Link>{' '}
          first: the inbox sends its drafts through that app.
        </p>
      ) : !data.serverReady ? (
        <p className="mt-4 rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-2">
          The Brainspace Slack app isn't set up to receive messages on this server yet. Whoever runs it needs to turn on event subscriptions for the app (docs/slack-app.md).
        </p>
      ) : !data.connected ? (
        <div className="mt-4 rounded-lg border border-line p-4">
          <p className="text-[13.5px] text-ink-2">
            Connect your own account in {data.slackWorkspace ?? 'Slack'}. Slack will ask you to let Brainspace read the messages you can see: your DMs and the channels you're in.
            Only your own private bots can use that, and you can disconnect at any time.
          </p>
          {data.canSetUp && (
            <Button variant="primary" className="mt-3" onClick={connect} loading={busy === 'connect'}>
              <Inbox className="size-4" /> Connect Slack
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4 rounded-lg border border-line p-4">
          <div>
            <div className="text-[13px] font-medium">Bot that gets your messages</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Select className="min-w-56 flex-1" value={data.botId ?? ''} onChange={(e) => act('bot', () => slackInboxUpdateFn({ data: { botId: e.target.value || null } }))}>
                <option value="">None</option>
                {data.bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              <Button onClick={() => act('create', () => slackInboxCreateBotFn(), 'Created a bot that drafts replies and DMs them to you')} loading={busy === 'create'}>
                Create one for me
              </Button>
              {data.botId && (
                <Link to="/app/bots/$botId" params={{ botId: data.botId }} className="text-[13px] font-medium underline">
                  Open the bot
                </Link>
              )}
            </div>
            <p className="mt-1.5 text-[12.5px] text-ink-3">
              It has to be one of your private bots, because it is shown your messages. "Create one for me" makes a read-only bot that works out the answer and DMs you a draft in your voice; change
              its instructions like any other bot.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Toggle on={data.dms} onChange={(v) => act('dms', () => slackInboxUpdateFn({ data: { dms: v } }))} icon={<MessageSquare />} label="Direct messages" hint="When someone DMs you." />
            <Toggle on={data.mentions} onChange={(v) => act('mentions', () => slackInboxUpdateFn({ data: { mentions: v } }))} icon={<AtSign />} label="@mentions" hint="In channels, threads and group DMs." />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="mr-auto text-[12.5px] text-ink-3">{data.lastEventAt ? `Last message handled ${timeAgo(data.lastEventAt)}.` : 'No messages handled yet.'}</span>
            <Button size="sm" onClick={() => act('enabled', () => slackInboxUpdateFn({ data: { enabled: !data.enabled } }), data.enabled ? 'Paused' : 'Resumed')}>
              {data.enabled ? 'Pause' : 'Resume'}
            </Button>
            <Button size="sm" onClick={() => confirm('Disconnect your Slack account? Brainspace hands its access back to Slack.') && act('disconnect', () => slackInboxDisconnectFn(), 'Disconnected')}>
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

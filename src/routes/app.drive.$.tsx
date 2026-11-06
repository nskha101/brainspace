import { createFileRoute, redirect } from '@tanstack/react-router'

// Old links (Slack messages, flow run deliveries) point at /app/drive/...
export const Route = createFileRoute('/app/drive/$')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/app/space/$', params: { _splat: params._splat }, replace: true })
  },
})

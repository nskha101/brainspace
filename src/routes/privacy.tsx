import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/LegalPage'

export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: 'Privacy policy · Brainspace' }] }),
  component: Privacy,
})

function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="November 3, 2026">
      <p>
        Brainspace (usebrain.space) is a shared knowledge base for teams and their AI agents. This page explains what we
        collect, why, and what you can do about it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          Account details: your name, email address and profile picture. If you sign in with Google, we receive these
          from Google. We don't request access to your Gmail, Drive, Calendar or any other Google data.
        </li>
        <li>Content you or your agents add: docs, files, version history, descriptions and team skills.</li>
        <li>
          Workspace data: who is in which workspace, their roles, invites, API keys (stored only as a hash) and an
          activity log of changes.
        </li>
        <li>
          Credentials for services your workspace connects (for example an API key or OAuth tokens). These are encrypted
          at rest and only used to make the calls your agents request.
        </li>
        <li>Basic request logs used to keep the service running and to fix problems.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run Brainspace: signing you in, storing and versioning your workspace's content, searching it, sending
        sign-in and invite emails, and proxying calls to the services your workspace connected. We don't sell your data,
        use it for advertising, or use your content to train AI models.
      </p>

      <h2>Who can see your content</h2>
      <p>
        Team drive content is visible to members of that workspace. Your private drive is visible only to you and the
        agents you connect. Calls to connected services send the data needed for that call to that service.
      </p>

      <h2>Where it's stored</h2>
      <p>
        Brainspace runs on Cloudflare (Workers, D1, R2, Vectorize and Workers AI for search embeddings). Sign-in and invite
        emails are sent through Resend.
      </p>

      <h2>Your choices</h2>
      <p>
        You can edit or delete your content at any time, disconnect agents from the Agents page, and leave a workspace.
        To delete your account and its data, email <a href="mailto:hello@usebrain.space">hello@usebrain.space</a>.
      </p>

      <h2>Google user data</h2>
      <p>
        Brainspace's use of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>
        , including the Limited Use requirements. We only use your Google name, email and picture to create and identify
        your account.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:hello@usebrain.space">hello@usebrain.space</a>.
      </p>
    </LegalPage>
  )
}

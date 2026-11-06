import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/LegalPage'

export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: 'Terms of service · Brainspace' }] }),
  component: Terms,
})

function Terms() {
  return (
    <LegalPage title="Terms of service" updated="November 3, 2026">
      <p>These terms cover your use of Brainspace at usebrain.space. By using it, you agree to them.</p>

      <h2>Your content</h2>
      <p>
        You and your workspace own what you put in Brainspace. You give us permission to store, process and display it
        only as needed to run the service for you. You're responsible for having the right to upload it.
      </p>

      <h2>Agents and connections</h2>
      <p>
        Agents you connect act as you, with your role. You're responsible for what they do in your workspace. When your
        workspace connects a third-party service, use of that service is also governed by its own terms.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Don't use Brainspace to break the law or to store content you aren't allowed to share.</li>
        <li>Don't try to access workspaces, spaces or data you haven't been given access to.</li>
        <li>Don't overload or attack the service or the services connected to it.</li>
      </ul>

      <h2>Availability</h2>
      <p>
        We work to keep Brainspace running and your data safe, but the service is provided as is, without warranties.
        Keep copies of anything you can't afford to lose. We may change or discontinue features, and we'll give notice
        before shutting down the service.
      </p>

      <h2>Liability</h2>
      <p>To the extent the law allows, we aren't liable for indirect or consequential losses from using Brainspace.</p>

      <h2>Ending your use</h2>
      <p>
        You can stop using Brainspace at any time. We may suspend accounts that break these terms. Ask us and we'll
        delete your data.
      </p>

      <h2>Changes</h2>
      <p>If we change these terms, we'll update the date above. Using Brainspace after a change means you accept it.</p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:hello@usebrain.space">hello@usebrain.space</a>
      </p>
    </LegalPage>
  )
}

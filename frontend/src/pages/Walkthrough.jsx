import { Card } from '../components/common/Card'

const steps = [
  {
    title: '1) Connect WhatsApp Number',
    description: 'Go to WA Numbers, add your number, open QR, and scan from WhatsApp mobile app.',
    route: '/whatsapp',
  },
  {
    title: '2) Configure AI Agent',
    description: 'Open AI Agent and set business details, tone, hours, FAQs and response behavior.',
    route: '/ai',
  },
  {
    title: '3) Import & Organize Contacts',
    description: 'Use Contacts to create labels, tags and quickly segment your audience.',
    route: '/contacts',
  },
  {
    title: '4) Start Support in Inbox',
    description: 'Handle live chats in Inbox while AI assists with faster responses and follow-through.',
    route: '/inbox',
  },
  {
    title: '5) Launch Campaigns & Followups',
    description: 'Use Campaigns and Followups to run broadcasts and no-reply automations.',
    route: '/campaigns',
  },
  {
    title: '6) Track Analytics, API Usage & Billing',
    description: 'Monitor growth from Analytics, API usage in Dashboard, and subscription in Billing.',
    route: '/analytics',
  },
]

export const WalkthroughPage = () => {
  return (
    <div className="page active">
      <div className="section-title">Interactive Walkthrough</div>
      <div className="section-sub">Follow these steps to understand and run the full system quickly.</div>

      <div className="camp-grid">
        {steps.map((step) => (
          <Card key={step.title} title={step.title}>
            <div className="cc-desc" style={{ marginBottom: 10 }}>{step.description}</div>
            <a className="btn btn-primary" href={step.route} style={{ textDecoration: 'none' }}>
              Open
            </a>
          </Card>
        ))}
      </div>
    </div>
  )
}

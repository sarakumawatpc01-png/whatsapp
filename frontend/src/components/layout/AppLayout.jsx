import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export const AppLayout = ({ children }) => {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div id="main">
        <Topbar />
        <div id="content">
          {children}
        </div>
      </div>
    </div>
  )
}

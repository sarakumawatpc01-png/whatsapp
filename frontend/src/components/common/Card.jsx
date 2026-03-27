export const Card = ({ title, action, children, style }) => (
  <div className="card" style={style}>
    {(title || action) && (
      <div className="card-head">
        <div className="card-title">{title}</div>
        {action}
      </div>
    )}
    {children}
  </div>
)

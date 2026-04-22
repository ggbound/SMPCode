function TitleBar() {
  return (
    <div className="title-bar">
      {/* 左侧占位 - 为 macOS 红绿灯按钮预留空间 */}
      <div className="title-bar-traffic-lights"></div>
      
      {/* 应用标题 - 居中显示 */}
      <div className="title-bar-title">SMP Code</div>
      
      {/* 右侧占位，保持标题居中 */}
      <div className="title-bar-spacer"></div>
    </div>
  )
}

export default TitleBar

import React, { useEffect, useState } from "react";
import { detectHardwareAcceleration, HardwareAccelerationInfo, getCachedHardwareInfo } from "../utils/hardwareDetector";

export const HardwareBadge: React.FC<{ showDetail?: boolean }> = ({ showDetail = false }) => {
  const [hw, setHw] = useState<HardwareAccelerationInfo>(getCachedHardwareInfo());

  useEffect(() => {
    detectHardwareAcceleration().then(setHw);
  }, []);

  const badgeStyles: Record<string, React.CSSProperties> = {
    NPU: {
      background: "linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 95, 70, 0.4))",
      border: "1px solid rgba(16, 185, 129, 0.6)",
      color: "#34d399",
    },
    GPU: {
      background: "linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(30, 58, 138, 0.4))",
      border: "1px solid rgba(59, 130, 246, 0.6)",
      color: "#60a5fa",
    },
    CPU_SIMD: {
      background: "linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(88, 28, 135, 0.4))",
      border: "1px solid rgba(168, 85, 247, 0.6)",
      color: "#c084fc",
    },
    PURE_JS: {
      background: "rgba(100, 116, 139, 0.2)",
      border: "1px solid rgba(148, 163, 184, 0.4)",
      color: "#cbd5e1",
    }
  };

  const style = badgeStyles[hw.tier] || badgeStyles.CPU_SIMD;

  return (
    <div
      title={`${hw.label} — ${hw.description}\n硬體單元: ${hw.hardwareUnit}\n推論延遲: ${hw.fpsBoost}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 10px",
        borderRadius: "12px",
        fontSize: "0.76rem",
        fontWeight: 600,
        cursor: "help",
        transition: "all 0.2s ease",
        ...style,
      }}
    >
      <span>{hw.badge}</span>
      {showDetail && (
        <span style={{ opacity: 0.85, fontSize: "0.72rem", borderLeft: "1px solid rgba(255,255,255,0.2)", paddingLeft: "6px" }}>
          {hw.fpsBoost}
        </span>
      )}
    </div>
  );
};

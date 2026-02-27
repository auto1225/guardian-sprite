import { Navigate } from "react-router-dom";

const SERIAL_STORAGE_KEY = "meercop_serial_key";
const SERIAL_DATA_KEY = "meercop_serial_data";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const savedSerial = localStorage.getItem(SERIAL_STORAGE_KEY);
  const savedData = localStorage.getItem(SERIAL_DATA_KEY);

  if (!savedSerial || !savedData) {
    return <Navigate to="/auth" replace />;
  }

  // Check expiry
  try {
    const data = JSON.parse(savedData);
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      localStorage.removeItem(SERIAL_STORAGE_KEY);
      localStorage.removeItem(SERIAL_DATA_KEY);
      return <Navigate to="/auth" replace />;
    }
  } catch {
    localStorage.removeItem(SERIAL_STORAGE_KEY);
    localStorage.removeItem(SERIAL_DATA_KEY);
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

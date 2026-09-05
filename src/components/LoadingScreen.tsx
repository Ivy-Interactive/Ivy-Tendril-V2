import { useEffect, useState } from "react";
import { Loading } from "./Loading";

export interface LoadingScreenProps {}

export const LoadingScreen: React.FC<LoadingScreenProps> = () => {
  const [showAnimation, setShowAnimation] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowAnimation(true);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex items-center justify-center h-full overflow-hidden">
      {showAnimation && <Loading />}
    </div>
  );
};

export default LoadingScreen;

import { Coins } from "lucide-react";

export function KowopeBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-8 w-8 rounded-lg bg-[#1169C7] flex items-center justify-center shadow-md shadow-blue-600/30">
        <Coins className="h-4 w-4 text-white" />
      </div>
      <span className="text-xl font-black tracking-tight text-foreground">
        Ko<span className="text-[#1169C7]">wope</span>
      </span>
    </div>
  );
}

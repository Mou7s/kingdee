param(
  [int]$X1,
  [int]$Y1,
  [int]$X2,
  [int]$Y2,
  [int]$Steps = 30,
  [int]$StepMs = 25
)

Add-Type @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct INPUT {
    public uint type;
    public MOUSEINPUT mi;
    public static int Size { get { return Marshal.SizeOf(typeof(INPUT)); } }
}

[StructLayout(LayoutKind.Sequential)]
public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
public struct POINT {
    public int X;
    public int Y;
}

[StructLayout(LayoutKind.Sequential)]
public struct CURSORINFO {
    public int cbSize;
    public int flags;
    public IntPtr hCursor;
    public POINT ptScreenPos;
}

public static class Win32DragDiag {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern bool GetCursorInfo(ref CURSORINFO pci);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    public const uint INPUT_MOUSE = 0;
    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    public static void MoveAbs(int x, int y) {
        int sw = Math.Max(1, GetSystemMetrics(0) - 1);
        int sh = Math.Max(1, GetSystemMetrics(1) - 1);
        int ax = (int)Math.Round(x * 65535.0 / sw);
        int ay = (int)Math.Round(y * 65535.0 / sh);
        INPUT[] inp = new INPUT[1];
        inp[0].type = INPUT_MOUSE;
        inp[0].mi.dx = ax;
        inp[0].mi.dy = ay;
        inp[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
        SendInput(1, inp, INPUT.Size);
    }

    public static void LeftDown() {
        INPUT[] inp = new INPUT[1];
        inp[0].type = INPUT_MOUSE;
        inp[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
        SendInput(1, inp, INPUT.Size);
    }

    public static void LeftUp() {
        INPUT[] inp = new INPUT[1];
        inp[0].type = INPUT_MOUSE;
        inp[0].mi.dwFlags = MOUSEEVENTF_LEFTUP;
        SendInput(1, inp, INPUT.Size);
    }

    public static string Diag(string tag) {
        CURSORINFO ci = new CURSORINFO();
        ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
        GetCursorInfo(ref ci);
        bool lbtn = (GetAsyncKeyState(0x01) & 0x8000) != 0;
        return string.Format("{0}: pt=({1},{2}) hCursor=0x{3:X} LBtnDown={4}", tag, ci.ptScreenPos.X, ci.ptScreenPos.Y, ci.hCursor.ToInt64(), lbtn);
    }
}
"@

[Win32DragDiag]::MoveAbs($X1, $Y1)
Start-Sleep -Milliseconds 100
Write-Output ([Win32DragDiag]::Diag("Start"))

[Win32DragDiag]::LeftDown()
Start-Sleep -Milliseconds 180
Write-Output ([Win32DragDiag]::Diag("AfterDown"))

$sx = $X1 + 15
[Win32DragDiag]::MoveAbs($sx, $Y1)
Start-Sleep -Milliseconds 180
Write-Output ([Win32DragDiag]::Diag("AfterMove15px"))

$midStep = [int]($Steps / 2)
for ($i = 1; $i -le $Steps; $i++) {
    $t = $i / [double]$Steps
    $nx = [int][Math::Round($sx + ($X2 - $sx) * $t))
    $ny = [int][Math::Round($Y1 + ($Y2 - $Y1) * $t))
    [Win32DragDiag]::MoveAbs($nx, $ny)
    if ($i -eq $midStep) {
        Start-Sleep -Milliseconds 50
        Write-Output ([Win32DragDiag]::Diag("MidCanvas"))
    }
    Start-Sleep -Milliseconds $StepMs
}

Start-Sleep -Milliseconds 180
Write-Output ([Win32DragDiag]::Diag("AtTarget"))

[Win32DragDiag]::LeftUp()
Start-Sleep -Milliseconds 150
Write-Output ([Win32DragDiag]::Diag("AfterUp"))

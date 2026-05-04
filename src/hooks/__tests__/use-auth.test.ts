import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuth } from "@/hooks/use-auth";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: vi.fn(),
  clearAnonWork: vi.fn(),
}));

vi.mock("@/actions/get-projects", () => ({
  getProjects: vi.fn(),
}));

vi.mock("@/actions/create-project", () => ({
  createProject: vi.fn(),
}));

import { signIn as signInAction, signUp as signUpAction } from "@/actions";
import { getAnonWorkData, clearAnonWork } from "@/lib/anon-work-tracker";
import { getProjects } from "@/actions/get-projects";
import { createProject } from "@/actions/create-project";

const mockAnonWork = {
  messages: [{ id: "1", role: "user", content: "Hello" }],
  fileSystemData: { "/app.tsx": { type: "file", content: "export default () => <div />" } },
};

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("initializes with isLoading false", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(false);
  });

  test("exposes signIn and signUp functions", () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.signIn).toBe("function");
    expect(typeof result.current.signUp).toBe("function");
  });

  describe("signIn", () => {
    test("sets isLoading to true while signing in then resets to false", async () => {
      let resolveSignIn!: (val: any) => void;
      (signInAction as any).mockReturnValue(new Promise((r) => (resolveSignIn = r)));
      (getProjects as any).mockResolvedValue([]);
      (createProject as any).mockResolvedValue({ id: "proj-1" });
      (getAnonWorkData as any).mockReturnValue(null);

      const { result } = renderHook(() => useAuth());

      let signInPromise: Promise<any>;
      act(() => {
        signInPromise = result.current.signIn("user@test.com", "password123");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSignIn({ success: true });
        await signInPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("calls signInAction with the provided email and password", async () => {
      (signInAction as any).mockResolvedValue({ success: false, error: "Invalid credentials" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@test.com", "password123");
      });

      expect(signInAction).toHaveBeenCalledWith("user@test.com", "password123");
    });

    test("returns the result from signInAction", async () => {
      const failResult = { success: false, error: "Invalid credentials" };
      (signInAction as any).mockResolvedValue(failResult);

      const { result } = renderHook(() => useAuth());
      let returnValue: any;

      await act(async () => {
        returnValue = await result.current.signIn("user@test.com", "wrongpass");
      });

      expect(returnValue).toEqual(failResult);
    });

    test("does not call handlePostSignIn when signIn fails", async () => {
      (signInAction as any).mockResolvedValue({ success: false, error: "Invalid credentials" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@test.com", "wrongpass");
      });

      expect(getAnonWorkData).not.toHaveBeenCalled();
      expect(getProjects).not.toHaveBeenCalled();
      expect(createProject).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    test("resets isLoading to false even when signInAction throws", async () => {
      (signInAction as any).mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@test.com", "password123").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });

    describe("handlePostSignIn — with anonymous work", () => {
      test("creates project from anon work and navigates to it", async () => {
        (signInAction as any).mockResolvedValue({ success: true });
        (getAnonWorkData as any).mockReturnValue(mockAnonWork);
        (createProject as any).mockResolvedValue({ id: "anon-proj-42" });

        const { result } = renderHook(() => useAuth());

        await act(async () => {
          await result.current.signIn("user@test.com", "password123");
        });

        expect(createProject).toHaveBeenCalledWith({
          name: expect.stringMatching(/^Design from /),
          messages: mockAnonWork.messages,
          data: mockAnonWork.fileSystemData,
        });
        expect(clearAnonWork).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/anon-proj-42");
      });

      test("does not call getProjects when anon work exists with messages", async () => {
        (signInAction as any).mockResolvedValue({ success: true });
        (getAnonWorkData as any).mockReturnValue(mockAnonWork);
        (createProject as any).mockResolvedValue({ id: "anon-proj-42" });

        const { result } = renderHook(() => useAuth());

        await act(async () => {
          await result.current.signIn("user@test.com", "password123");
        });

        expect(getProjects).not.toHaveBeenCalled();
      });
    });

    describe("handlePostSignIn — anon work with empty messages", () => {
      test("falls through to getProjects when messages array is empty", async () => {
        (signInAction as any).mockResolvedValue({ success: true });
        (getAnonWorkData as any).mockReturnValue({ messages: [], fileSystemData: {} });
        (getProjects as any).mockResolvedValue([{ id: "existing-proj" }]);

        const { result } = renderHook(() => useAuth());

        await act(async () => {
          await result.current.signIn("user@test.com", "password123");
        });

        expect(getProjects).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/existing-proj");
      });
    });

    describe("handlePostSignIn — no anonymous work, has existing projects", () => {
      test("navigates to the most recent project", async () => {
        (signInAction as any).mockResolvedValue({ success: true });
        (getAnonWorkData as any).mockReturnValue(null);
        (getProjects as any).mockResolvedValue([
          { id: "recent-proj" },
          { id: "older-proj" },
        ]);

        const { result } = renderHook(() => useAuth());

        await act(async () => {
          await result.current.signIn("user@test.com", "password123");
        });

        expect(mockPush).toHaveBeenCalledWith("/recent-proj");
        expect(createProject).not.toHaveBeenCalled();
      });
    });

    describe("handlePostSignIn — no anonymous work, no existing projects", () => {
      test("creates a new blank project and navigates to it", async () => {
        (signInAction as any).mockResolvedValue({ success: true });
        (getAnonWorkData as any).mockReturnValue(null);
        (getProjects as any).mockResolvedValue([]);
        (createProject as any).mockResolvedValue({ id: "new-proj-99" });

        const { result } = renderHook(() => useAuth());

        await act(async () => {
          await result.current.signIn("user@test.com", "password123");
        });

        expect(createProject).toHaveBeenCalledWith({
          name: expect.stringMatching(/^New Design #\d+$/),
          messages: [],
          data: {},
        });
        expect(mockPush).toHaveBeenCalledWith("/new-proj-99");
      });

      test("does not clear anon work when none exists", async () => {
        (signInAction as any).mockResolvedValue({ success: true });
        (getAnonWorkData as any).mockReturnValue(null);
        (getProjects as any).mockResolvedValue([]);
        (createProject as any).mockResolvedValue({ id: "new-proj-99" });

        const { result } = renderHook(() => useAuth());

        await act(async () => {
          await result.current.signIn("user@test.com", "password123");
        });

        expect(clearAnonWork).not.toHaveBeenCalled();
      });
    });
  });

  describe("signUp", () => {
    test("sets isLoading to true while signing up then resets to false", async () => {
      let resolveSignUp!: (val: any) => void;
      (signUpAction as any).mockReturnValue(new Promise((r) => (resolveSignUp = r)));
      (getAnonWorkData as any).mockReturnValue(null);
      (getProjects as any).mockResolvedValue([]);
      (createProject as any).mockResolvedValue({ id: "proj-1" });

      const { result } = renderHook(() => useAuth());

      let signUpPromise: Promise<any>;
      act(() => {
        signUpPromise = result.current.signUp("newuser@test.com", "password123");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSignUp({ success: true });
        await signUpPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("calls signUpAction with the provided email and password", async () => {
      (signUpAction as any).mockResolvedValue({ success: false, error: "Email already registered" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("existing@test.com", "password123");
      });

      expect(signUpAction).toHaveBeenCalledWith("existing@test.com", "password123");
    });

    test("returns the result from signUpAction", async () => {
      const failResult = { success: false, error: "Email already registered" };
      (signUpAction as any).mockResolvedValue(failResult);

      const { result } = renderHook(() => useAuth());
      let returnValue: any;

      await act(async () => {
        returnValue = await result.current.signUp("existing@test.com", "password123");
      });

      expect(returnValue).toEqual(failResult);
    });

    test("does not call handlePostSignIn when signUp fails", async () => {
      (signUpAction as any).mockResolvedValue({ success: false, error: "Email already registered" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("existing@test.com", "password123");
      });

      expect(getAnonWorkData).not.toHaveBeenCalled();
      expect(getProjects).not.toHaveBeenCalled();
      expect(createProject).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    test("resets isLoading to false even when signUpAction throws", async () => {
      (signUpAction as any).mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("user@test.com", "password123").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("on success with anon work, creates project and navigates", async () => {
      (signUpAction as any).mockResolvedValue({ success: true });
      (getAnonWorkData as any).mockReturnValue(mockAnonWork);
      (createProject as any).mockResolvedValue({ id: "anon-proj-signup" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("newuser@test.com", "password123");
      });

      expect(createProject).toHaveBeenCalledWith({
        name: expect.stringMatching(/^Design from /),
        messages: mockAnonWork.messages,
        data: mockAnonWork.fileSystemData,
      });
      expect(clearAnonWork).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/anon-proj-signup");
    });

    test("on success with no anon work and existing projects, navigates to first project", async () => {
      (signUpAction as any).mockResolvedValue({ success: true });
      (getAnonWorkData as any).mockReturnValue(null);
      (getProjects as any).mockResolvedValue([{ id: "my-proj" }]);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("newuser@test.com", "password123");
      });

      expect(mockPush).toHaveBeenCalledWith("/my-proj");
    });

    test("on success with no anon work and no projects, creates a new project", async () => {
      (signUpAction as any).mockResolvedValue({ success: true });
      (getAnonWorkData as any).mockReturnValue(null);
      (getProjects as any).mockResolvedValue([]);
      (createProject as any).mockResolvedValue({ id: "fresh-proj" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("newuser@test.com", "password123");
      });

      expect(createProject).toHaveBeenCalledWith({
        name: expect.stringMatching(/^New Design #\d+$/),
        messages: [],
        data: {},
      });
      expect(mockPush).toHaveBeenCalledWith("/fresh-proj");
    });
  });
});

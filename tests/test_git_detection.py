"""
Tests for git detection functionality.

These tests validate:
1. Non-git directories return nulls
2. Regular git repos return branch and repo name
3. Worktree detection works correctly
4. Edge cases (missing dirs, None input, detached HEAD)
"""

import os
import subprocess
import tempfile
import shutil
import pytest

# Import the functions to test
from mainthread.server import _run_git_command, _detect_git_info_sync


class TestGitCommandRunner:
    """Test the _run_git_command helper."""

    def test_successful_command(self, tmp_path):
        """Running a valid git command in a git repo should succeed."""
        # Create a git repo
        subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True)

        success, output = _run_git_command(
            ["git", "rev-parse", "--is-inside-work-tree"],
            str(tmp_path),
        )
        assert success is True
        assert output == "true"

    def test_failed_command_non_git_dir(self, tmp_path):
        """Running git command in non-git directory should fail gracefully."""
        success, output = _run_git_command(
            ["git", "rev-parse", "--is-inside-work-tree"],
            str(tmp_path),
        )
        assert success is False
        assert output == ""

    def test_invalid_directory(self):
        """Running git command in non-existent directory should fail gracefully."""
        success, output = _run_git_command(
            ["git", "status"],
            "/nonexistent/path/that/does/not/exist",
        )
        assert success is False
        assert output == ""


class TestGitInfoDetection:
    """Test the _detect_git_info_sync function."""

    def test_none_work_dir(self):
        """None work_dir should return all nulls."""
        result = _detect_git_info_sync(None)
        assert result == {"git_branch": None, "git_repo": None, "is_worktree": False}

    def test_nonexistent_directory(self):
        """Non-existent directory should return all nulls."""
        result = _detect_git_info_sync("/path/that/definitely/does/not/exist")
        assert result == {"git_branch": None, "git_repo": None, "is_worktree": False}

    def test_non_git_directory(self, tmp_path):
        """Non-git directory should return all nulls."""
        result = _detect_git_info_sync(str(tmp_path))
        assert result == {"git_branch": None, "git_repo": None, "is_worktree": False}

    def test_git_repo_with_branch(self, tmp_path):
        """Git repo should return branch and repo name."""
        # Initialize a git repo
        subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=tmp_path,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=tmp_path,
            capture_output=True,
        )
        # Create an initial commit so HEAD exists
        test_file = tmp_path / "test.txt"
        test_file.write_text("test content")
        subprocess.run(["git", "add", "."], cwd=tmp_path, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=tmp_path, capture_output=True)

        result = _detect_git_info_sync(str(tmp_path))

        # Branch should be main or master (depending on git config)
        assert result["git_branch"] in ["main", "master"]
        # Repo name should be the directory name
        assert result["git_repo"] == tmp_path.name
        assert result["is_worktree"] is False

    def test_detached_head_state(self, tmp_path):
        """Detached HEAD should return commit hash in parentheses."""
        # Initialize repo with a commit
        subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=tmp_path,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=tmp_path,
            capture_output=True,
        )
        test_file = tmp_path / "test.txt"
        test_file.write_text("test content")
        subprocess.run(["git", "add", "."], cwd=tmp_path, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=tmp_path, capture_output=True)

        # Get commit hash and checkout detached
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=tmp_path,
            capture_output=True,
            text=True,
        )
        commit_hash = result.stdout.strip()
        subprocess.run(["git", "checkout", commit_hash], cwd=tmp_path, capture_output=True)

        result = _detect_git_info_sync(str(tmp_path))

        # Branch should be (short_hash) format
        assert result["git_branch"].startswith("(")
        assert result["git_branch"].endswith(")")
        assert len(result["git_branch"]) > 2  # Not just "()"

    def test_worktree_detection(self, tmp_path):
        """Worktree should be detected correctly."""
        # Create main repo
        main_repo = tmp_path / "main"
        main_repo.mkdir()
        subprocess.run(["git", "init"], cwd=main_repo, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=main_repo,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=main_repo,
            capture_output=True,
        )
        test_file = main_repo / "test.txt"
        test_file.write_text("test content")
        subprocess.run(["git", "add", "."], cwd=main_repo, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=main_repo, capture_output=True)

        # Create a worktree
        worktree_path = tmp_path / "worktree"
        subprocess.run(
            ["git", "worktree", "add", "-b", "feature", str(worktree_path)],
            cwd=main_repo,
            capture_output=True,
        )

        # Test main repo - should not be worktree
        main_result = _detect_git_info_sync(str(main_repo))
        assert main_result["is_worktree"] is False

        # Test worktree - should be worktree
        worktree_result = _detect_git_info_sync(str(worktree_path))
        assert worktree_result["is_worktree"] is True
        assert worktree_result["git_branch"] == "feature"

    def test_repo_name_from_remote_url(self, tmp_path):
        """Repo name should be extracted from remote URL if available."""
        # Initialize repo
        subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=tmp_path,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=tmp_path,
            capture_output=True,
        )
        test_file = tmp_path / "test.txt"
        test_file.write_text("test content")
        subprocess.run(["git", "add", "."], cwd=tmp_path, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=tmp_path, capture_output=True)

        # Add a remote
        subprocess.run(
            ["git", "remote", "add", "origin", "https://github.com/testuser/my-awesome-repo.git"],
            cwd=tmp_path,
            capture_output=True,
        )

        result = _detect_git_info_sync(str(tmp_path))
        assert result["git_repo"] == "my-awesome-repo"

    def test_repo_name_from_ssh_url(self, tmp_path):
        """Repo name should be extracted from SSH-style remote URL."""
        # Initialize repo
        subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=tmp_path,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=tmp_path,
            capture_output=True,
        )
        test_file = tmp_path / "test.txt"
        test_file.write_text("test content")
        subprocess.run(["git", "add", "."], cwd=tmp_path, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=tmp_path, capture_output=True)

        # Add an SSH remote
        subprocess.run(
            ["git", "remote", "add", "origin", "git@github.com:testuser/ssh-repo.git"],
            cwd=tmp_path,
            capture_output=True,
        )

        result = _detect_git_info_sync(str(tmp_path))
        assert result["git_repo"] == "ssh-repo"

    def test_symlinked_path(self, tmp_path):
        """Git detection should work correctly with symlinked paths."""
        # Create actual repo
        actual_repo = tmp_path / "actual"
        actual_repo.mkdir()
        subprocess.run(["git", "init"], cwd=actual_repo, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=actual_repo,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=actual_repo,
            capture_output=True,
        )
        test_file = actual_repo / "test.txt"
        test_file.write_text("test content")
        subprocess.run(["git", "add", "."], cwd=actual_repo, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=actual_repo, capture_output=True)

        # Create symlink to repo
        symlink_path = tmp_path / "symlink"
        symlink_path.symlink_to(actual_repo)

        # Both paths should work
        actual_result = _detect_git_info_sync(str(actual_repo))
        symlink_result = _detect_git_info_sync(str(symlink_path))

        # Both should detect the same branch
        assert actual_result["git_branch"] == symlink_result["git_branch"]
        # Both should detect it's not a worktree
        assert actual_result["is_worktree"] is False
        assert symlink_result["is_worktree"] is False

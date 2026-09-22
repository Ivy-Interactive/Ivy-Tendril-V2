use tendril_core::git::parse_git_diff;

#[test]
fn test_parse_git_diff_empty() {
    let diff = "";
    let files = parse_git_diff(diff);
    assert!(files.is_empty());
}

#[test]
fn test_parse_git_diff_single_file() {
    let diff = r#"diff --git a/src/main.rs b/src/main.rs
index 1234567..89abcdef 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 fn main() {
+    println!("Hello, world!");
-    println!("Old line");
 }
"#;

    let files = parse_git_diff(diff);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].file_path, "src/main.rs");
    assert_eq!(files[0].additions, 1);
    assert_eq!(files[0].deletions, 1);
    assert!(files[0]
        .diff
        .contains("diff --git a/src/main.rs b/src/main.rs"));
}

#[test]
fn test_parse_git_diff_multiple_files() {
    let diff = r#"diff --git a/file1.txt b/file1.txt
index 0000000..1111111 100644
--- a/file1.txt
+++ b/file1.txt
@@ -0,0 +1,2 @@
+line 1
+line 2
diff --git a/file2.txt b/file2.txt
index 2222222..3333333 100644
--- a/file2.txt
+++ b/file2.txt
@@ -1,2 +1 @@
-old line 1
-old line 2
+new line 1
"#;

    let files = parse_git_diff(diff);
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].file_path, "file1.txt");
    assert_eq!(files[0].additions, 2);
    assert_eq!(files[0].deletions, 0);

    assert_eq!(files[1].file_path, "file2.txt");
    assert_eq!(files[1].additions, 1);
    assert_eq!(files[1].deletions, 2);
}

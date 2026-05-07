#!/usr/bin/env python3
"""
Standalone iClicker sync test — manual login + auto course discovery.

Strategy:
  1. Open Chrome, you log in manually (CalNet + Duo + trust browser).
  2. Bot dumps every course button title visible on the courses page.
  3. Bot downloads each course whose title contains "CS10".
  4. Bot writes each CSV to the DB.
"""
import logging
import os
import sys
import time
import glob
from pathlib import Path

os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5433")

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv("/Users/zhangweishu/Gradeview-new/.env")
os.environ["POSTGRES_HOST"] = "localhost"
os.environ["POSTGRES_PORT"] = "5433"
os.environ.pop("DATABASE_URL", None)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from api.core.iclicker_ingest import write_iclicker_attendance_to_db


COURSE_GRADESCOPE_ID = "1232070"
COURSE_NAME = "CS10: The Beauty and Joy of Computing"
COURSE_NAME_SUBSTRING = "CS10"   # match any course title containing this
DOWNLOAD_DIR = str(Path(__file__).parent / "iclicker_csv_exports")


def build_driver():
    Path(DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)
    prefs = {
        "download.default_directory": DOWNLOAD_DIR,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "plugins.always_open_pdf_externally": True,
    }
    opts = Options()
    opts.add_experimental_option("prefs", prefs)
    return webdriver.Chrome(service=Service(), options=opts)


def wait_for_courses_page(driver, timeout=300):
    print(">>> 请在 Chrome 里手动登录 iClicker (CalNet → Duo → Trust browser)")
    print(f">>> 最多等 {timeout} 秒")
    deadline = time.time() + timeout
    last_url = None
    while time.time() < deadline:
        url = driver.current_url or ""
        if url != last_url:
            print(f"    [URL] {url}")
            last_url = url
        if "instructor.iclicker.com" in url and "courses" in url:
            print(">>> ✅ 登录完成")
            return True
        time.sleep(2)
    raise TimeoutError("Did not land on iClicker courses page in time")


def discover_courses(driver, name_substring):
    """Return list of (title, button_element) for matching course buttons."""
    driver.get("https://instructor.iclicker.com/#/courses")
    time.sleep(5)

    # Course buttons usually carry a `title` attribute equal to the course name.
    # Fall back: any element with role="button" / button tag with text content.
    buttons = driver.find_elements(By.CSS_SELECTOR, "button[title]")
    print(f"\n=== Found {len(buttons)} buttons with title attribute ===")
    matches = []
    for b in buttons:
        title = (b.get_attribute("title") or "").strip()
        if not title:
            continue
        print(f"    button title=[{title}]")
        if name_substring.lower() in title.lower():
            matches.append((title, b))
    print(f"=== {len(matches)} match '{name_substring}' ===\n")
    return matches


def download_one_course(driver, title):
    """Click into a course, navigate to Attendance, export, and return the latest CSV path."""
    print(f">>> Downloading: {title}")
    driver.get("https://instructor.iclicker.com/#/courses")
    time.sleep(5)

    btn = WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, f"button[title='{title}']"))
    )
    btn.click()

    WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.XPATH, "//span[contains(text(), 'Attendance')]"))
    ).click()

    WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Export')]"))
    ).click()
    time.sleep(2)

    WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.ID, "check-box-header"))
    ).click()
    time.sleep(2)

    WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((
            By.XPATH,
            "//button[@type='submit' and contains(text(), 'Export')]",
        ))
    ).click()

    # Wait for the download
    time.sleep(12)

    csvs = glob.glob(os.path.join(DOWNLOAD_DIR, "*.csv"))
    if not csvs:
        raise FileNotFoundError("No CSV downloaded")
    latest = max(csvs, key=os.path.getmtime)
    print(f"    -> {latest}")
    return latest


def main():
    driver = build_driver()
    try:
        driver.get("https://instructor.iclicker.com/#/onboard/login")
        wait_for_courses_page(driver)

        matches = discover_courses(driver, COURSE_NAME_SUBSTRING)
        if not matches:
            print("⚠️  No matching courses found. Adjust COURSE_NAME_SUBSTRING.")
            return

        downloaded = {}
        for title, _ in matches:
            try:
                path = download_one_course(driver, title)
                downloaded[title] = path
            except Exception as e:
                print(f"!! Failed to download {title}: {e}")

        print("\n=== Writing to DB ===")
        for title, path in downloaded.items():
            try:
                res = write_iclicker_attendance_to_db(
                    course_gradescope_id=COURSE_GRADESCOPE_ID,
                    section_name=title,
                    csv_filepath=path,
                    course_name=COURSE_NAME,
                )
                print(f"  {title}: {res}")
            except Exception as e:
                print(f"!! DB write failed for {title}: {e}")

    finally:
        try:
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()

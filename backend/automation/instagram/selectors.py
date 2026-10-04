"""
Centralized Instagram UI selectors and locators.
Using resilient ARIA roles, accessible labels, and text selectors.
"""

class InstagramSelectors:
    # Authentication & Session
    LOGIN_INPUT_USERNAME = "input[name='username']"
    LOGIN_INPUT_PASSWORD = "input[name='password']"
    LOGIN_BUTTON = "button[type='submit']"
    NAV_HOME = "svg[aria-label='Home'], a[href='/']"
    NAV_DIRECT = "svg[aria-label='Direct'], svg[aria-label='Messages'], a[href*='/direct/']"
    NAV_SEARCH = "svg[aria-label='Search']"
    LOGGED_IN_PROFILE_ICON = "header img, nav img, svg[aria-label='Your profile']"

    # Challenges & Security
    CHALLENGE_CONTAINER = "text='Suspicious Login Attempt', text='Help Us Confirm You Own This Account', text='Confirm your info', text='Enter Security Code', text='Challenge Required'"
    CAPTCHA_CONTAINER = "iframe[src*='recaptcha'], iframe[src*='captcha'], div#recaptcha"

    # Profile Page
    PROFILE_HEADER = "header"
    PROFILE_USERNAME = "header h2, header h1, section h2"
    PROFILE_DISPLAY_NAME = "header section span, header h1"
    PROFILE_BIO = "header section > div:last-child"
    PROFILE_NOT_FOUND = "text='Sorry, this page isn't available.', text='The link you followed may be broken', text=\"Page Not Found\""
    
    # Message Action Buttons on Profile
    MESSAGE_BUTTON = [
        "div[role='button']:has-text('Message')",
        "button:has-text('Message')",
        "div[role='button']:has-text('Send message')",
        "button:has-text('Send message')",
        "a[role='button']:has-text('Message')"
    ]
    FOLLOW_BUTTON = "button:has-text('Follow'), div[role='button']:has-text('Follow')"
    RESTRICTED_MESSAGE = "text='You can\\'t message this account', text='Cannot be messaged', text='This account is private'"

    # Direct Message UI
    MESSAGE_COMPOSER = [
        "div[role='textbox'][contenteditable='true']",
        "div[aria-label='Message...'][contenteditable='true']",
        "div[aria-label='Message'][contenteditable='true']",
        "textarea[placeholder*='Message']"
    ]
    SEND_BUTTON = [
        "div[role='button']:has-text('Send')",
        "button:has-text('Send')",
        "svg[aria-label='Send']"
    ]
    CONVERSATION_CONTAINER = "div[role='main'], section[role='region']"
    SENT_MESSAGE_BUBBLES = "div[dir='auto'], div[role='row']"
    
    # Popups & Dialogs
    TURN_ON_NOTIFICATIONS_NOT_NOW = "button:has-text('Not Now'), div[role='button']:has-text('Not Now')"
    SAVE_INFO_NOT_NOW = "button:has-text('Not Now'), div[role='button']:has-text('Not Now'), button:has-text('Cancel')"

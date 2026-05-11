-- rename reminder_2h_sent → reminder_1h_sent: the window is 45–75 min (1h), not 2h
ALTER TABLE appointments RENAME COLUMN reminder_2h_sent TO reminder_1h_sent;
